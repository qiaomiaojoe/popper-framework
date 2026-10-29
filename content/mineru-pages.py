# POPPER · MinerU 转换（内容 1.2.3，见 mineru.cjs）。在 MinerU 自己的 Python 里跑：python -I mineru-pages.py，标准输入给一批任务（JSON）：
#   {"tier": "standard", "items": [{"pdf": 绝对路径, "out": 要写的 .md, "header": 第一行}]}
# 一篇一篇转（模型只加载一次），每页单独渲染成 Markdown，页前插一行 <!-- 第 N 页 -->（N 是 PDF 的第 N 页；页面上印的页码不一样时写成
# <!-- 第 N 页 · 印的页码 234 -->），先写临时文件、转完才改名。
# 标准输出一行一个 JSON 报进度：start / done / fail / fatal；MinerU 自己的日志走标准错误。
import json
import os
import re
import sys
import time
import traceback


def say(**ev):
    sys.stdout.write(json.dumps(ev, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def page_count(path):
    try:
        import pypdfium2
        doc = pypdfium2.PdfDocument(path)
        n = len(doc)
        doc.close()
        return n
    except Exception:
        return 0


# 页面上印的页码（MinerU 认出的 page_number 块，比如书里一章的第 234 页）：和 PDF 的第几页不一样时写进标记，引用时用它
PRINTED = re.compile(r"^\s*(?:-\s*)?(\d{1,5}|[ivxlcdm]{1,8})(?:\s*-)?\s*$", re.I)


def printed_number(page):
    for b in page.blocks:
        if str(getattr(b, "type", "")).split(".")[-1].lower() not in ("page_number", "blocktype.page_number"):
            continue
        text = "".join(str(getattr(c, "content", "") or "") for c in (getattr(b, "content", None) or []))
        m = PRINTED.match(text)
        if m:
            return m.group(1)
    return ""


def main():
    job = json.loads(sys.stdin.read() or "{}")
    tier = job.get("tier") or "standard"
    items = job.get("items") or []
    try:
        from mineru.parser import MinerUParser
        from mineru.render.markdown import render_markdown
    except Exception as e:  # 装坏了、版本不对
        say(ev="fatal", msg="MinerU 装得不完整或版本不对，按配置里「怎么装」重装一次（要 4.x 版）", raw=repr(e))
        return 2

    # 图片不放进文字稿（AI 读不了图，图注照样保留）：留一个占位，知道这里有图；公式没认出 LaTeX 时也留占位
    def image_renderer(block):
        t = str(getattr(block, "type", "") or "")
        return "[公式（没认出来）]" if "equation" in t else "[图]"

    parser = MinerUParser(tier=tier)
    for i, it in enumerate(items):
        pdf, out = it["pdf"], it["out"]
        pages = page_count(pdf)
        say(ev="start", i=i, pages=pages)
        t0 = time.time()
        tmp = out + ".转换中"
        try:
            result = parser.parse(pdf)
            mj = result.middle_json
            parts = [it.get("header") or ""]
            plist = sorted(mj.pages, key=lambda p: p.page_idx)
            # 认出来的印刷页码都和 PDF 页序号差同一个数（一章、一篇连续编页）：没认出的页（页码和页眉连在一起时常这样）按这个差补上
            found = {p.page_idx + 1: printed_number(p) for p in plist}
            offs = {int(v) - k for k, v in found.items() if v.isdigit()}
            if len(offs) == 1 and sum(1 for v in found.values() if v.isdigit()) >= 2:
                off = offs.pop()
                found = {k: (v or (str(k + off) if k + off > 0 else "")) for k, v in found.items()}
            for page in plist:
                one = mj.model_copy(update={"pages": [page]})
                text = render_markdown(one, image_renderer=image_renderer).strip()
                n = page.page_idx + 1
                printed = found.get(n, "")
                mark = "第 %d 页" % n + (" · 印的页码 %s" % printed if printed and printed != str(n) else "")
                parts.append("<!-- %s -->\n\n%s" % (mark, text or "（这一页没有文字）"))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as f:
                f.write("\n\n".join(parts).strip() + "\n")
            os.replace(tmp, out)
            say(ev="done", i=i, pages=len(mj.pages), secs=round(time.time() - t0, 1))
        except Exception as e:
            try:
                os.remove(tmp)
            except OSError:
                pass
            msg = str(e).strip().splitlines()[0][:160] if str(e).strip() else type(e).__name__
            if isinstance(e, MemoryError) or "out of memory" in str(e).lower():
                msg = "内存不够（关掉别的程序再试，或把大 PDF 拆小）"
            say(ev="fail", i=i, msg=msg)
            sys.stderr.write(traceback.format_exc())
    try:
        parser.close()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
