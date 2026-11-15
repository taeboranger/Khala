from pathlib import Path
from html import escape
import json
import sys
import zipfile
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output' / 'pdf' / 'test-kit'
OUT.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Malgun', 'C:/Windows/Fonts/malgun.ttf'))
pdfmetrics.registerFont(TTFont('MalgunBold', 'C:/Windows/Fonts/malgunbd.ttf'))
W, H = 595.28, 841.89
INK, GREEN, MUTED = '#1d2c35', '#176158', '#536571'
body_style = ParagraphStyle('body', fontName='Malgun', fontSize=10.5, leading=18, textColor=HexColor(INK), wordWrap='CJK')
small_style = ParagraphStyle('small', parent=body_style, fontSize=9, leading=15)

class Report:
    def __init__(self, filename, label, title):
        self.c = canvas.Canvas(str(OUT / filename), pagesize=(W, H))
        self.c.setTitle(title)
        self.c.setAuthor('KHALA 테스트용 가상 자료')
        self.c.setFillColor(HexColor(GREEN)); self.c.rect(0, H-14, W, 14, fill=1, stroke=0)
        self.y = H-60
        self.text(label, size=10, color=GREEN, bold=True)
        self.y -= 10
        self.text(title, size=21, bold=True)
        self.y -= 10
        self.paragraph('가상의 기관·수치로 구성한 기능 테스트 문서입니다. 실제 시장·업무 의사결정에 사용하지 않습니다.', small=True)
        self.y -= 6

    def text(self, text, size=11, color=INK, bold=False):
        self.c.setFont('MalgunBold' if bold else 'Malgun', size)
        self.c.setFillColor(HexColor(color)); self.c.drawString(44, self.y, text)
        self.y -= size + 9

    def paragraph(self, text, small=False):
        p = Paragraph(escape(text), small_style if small else body_style)
        _, h = p.wrap(W-88, H)
        if self.y-h < 55: raise ValueError('Page overflow')
        p.drawOn(self.c, 44, self.y-h); self.y -= h+9

    def section(self, title):
        self.y -= 8
        self.text(title, size=11, color=GREEN, bold=True)

    def table(self, rows, widths):
        cells = [[Paragraph(escape(str(cell)), small_style) for cell in row] for row in rows]
        table = Table(cells, colWidths=widths)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), HexColor('#e9f1ee')),
            ('LINEBELOW', (0,0), (-1,-1), .5, HexColor('#dbe3e7')),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('TOPPADDING', (0,0), (-1,-1), 10), ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ]))
        _, h = table.wrap(W-88, H)
        table.drawOn(self.c, 44, self.y-h); self.y -= h+12

    def finish(self):
        self.c.setStrokeColor(HexColor('#dbe3e7')); self.c.line(44, 43, W-44, 43)
        self.c.setFont('Malgun', 8); self.c.setFillColor(HexColor(MUTED))
        self.c.drawString(44, 28, 'KHALA 기능 테스트 | 가상 데이터 | 출처 원문을 문서 안에 포함')
        self.c.drawRightString(W-44, 28, '1 / 1')
        self.c.save()

samples = [
    ('01-market-scope-error.pdf', 'A1 · 작성자 최초 제출', '국내 SaaS 시장 검토', '글로벌', '매출액', 1800, 50),
    ('02-market-scope-fixed.pdf', 'A2 · 시장 범위 수정본', '국내 SaaS 시장 검토 - 수정본', '국내', '매출액', 1680, 40),
    ('03-reviewer-metric-error.pdf', 'B1 · 리뷰어 자신의 작업', 'SaaS 시장 비교 검토', '국내', '거래액', 1800, 50),
    ('04-reviewer-metric-fixed.pdf', 'B2 · 지표 정의 수정본', 'SaaS 시장 비교 검토 - 수정본', '국내', '매출액', 1560, 30),
    ('05-market-new-document.pdf', 'B3 · 새 문서의 가이드 상속 확인', 'SaaS 시장 후속 보고서', '국내', '매출액', 1800, 50),
]
if '--guide-only' not in sys.argv:
    for filename, label, title, scope, metric, value, percent in samples:
        r = Report(filename, label, title)
        r.section('보고서의 주장')
        r.paragraph(f'두 기관의 집계 자료를 비교한 결과, 2023년부터 2025년까지 국내 B2B SaaS 시장의 누적 성장률은 {percent}%였다.')
        r.section('비교에 사용한 수치')
        r.table([
            ['출처', '기준 연도', '시장 범위', '집계 지표', '규모'],
            ['A 미래산업연구원', '2023', '국내', '매출액', '1,200억 원'],
            ['B 한빛산업리서치', '2025', scope, metric, f'{value:,}억 원'],
        ], [142, 70, 82, 88, 125.28])
        r.section('출처 원문 발췌')
        r.paragraph('[A] 미래산업연구원, 2023 B2B SaaS 시장 집계, 표 2: “2023년 국내 B2B SaaS 시장의 연간 매출액은 1,200억 원으로 집계됐다.”')
        r.paragraph(f'[B] 한빛산업리서치, 2025 B2B SaaS 시장 집계, 표 4: “2025년 {scope} B2B SaaS 시장의 연간 {metric}은 {value:,}억 원으로 집계됐다.”')
        r.section('보고서에 기재한 산식')
        r.paragraph(f'({value:,} - 1,200) ÷ 1,200 × 100 = {percent}%')
        r.paragraph('두 시점 사이의 누적 변화율이다. 연평균 성장률(CAGR)과 구분한다.', small=True)
        r.finish()

    for fixed in (False, True):
        r = Report('07-general-survey-fixed.pdf' if fixed else '06-general-survey-error.pdf',
                   'C2 · 일반 문서 수정본' if fixed else 'C1 · 별도 업무 가이드 테스트',
                   '사내 도구 시범 운영 결과' + (' - 수정본' if fixed else ''))
        r.section('결과 요약')
        r.paragraph('응답자 10명 중 7명이 만족해 응답자 기준 만족도는 70%다. 설문 응답률은 50%이며, 전체 대상자나 전사 구성원에게 같은 비율을 일반화할 수 없다.' if fixed else
                    '시범 운영에 참여한 전체 구성원의 90%가 도구에 만족했다. 따라서 전사 구성원의 대부분이 도구에 만족할 것으로 판단한다.')
        r.section('설문 운영 기록')
        r.table([['항목', '기록'], ['설문 대상자', '시범 운영 참여자 20명'], ['실제 응답자', '10명'], ['만족 응답', '7명'], ['불만족 또는 중립 응답', '3명'], ['조사 기간', '2026년 10월 1일부터 10월 7일까지']], [180,327.28])
        r.section('근거 원문 발췌')
        r.paragraph('[S] 운영지원팀, 시범 운영 설문 결과, 집계표 1: “참여자 20명에게 설문을 발송했고 10명이 응답했다. 응답자 가운데 만족 7명, 중립 2명, 불만족 1명으로 집계됐다.”')
        r.section('판단에 필요한 계산')
        r.paragraph('응답자 기준 만족도 = 7 ÷ 10 × 100 = 70%. 설문 응답률 = 10 ÷ 20 × 100 = 50%.')
        r.paragraph('전사 구성원에 대한 별도 조사는 실시하지 않았다.', small=True)
        r.finish()

feedback = {
  'A': {
    '발견한 문제': '국내 시장 성장률을 설명하면서 국내 매출액과 글로벌 매출액을 비교했습니다. 시장 범위가 달라 이 비교는 성립하지 않습니다.',
    '판단 근거': '1쪽 A기관 표 2는 2023년 국내 매출액 1,200억 원, B기관 표 4는 2025년 글로벌 매출액 1,800억 원입니다. 지역과 포함 대상을 두 출처 원문에서 각각 확인해야 합니다.',
    '작성자가 할 일': 'B기관 수치를 같은 국내 시장의 2025년 매출액 1,680억 원 자료로 교체하고 누적 성장률을 40%로 수정하세요. 두 출처의 시장 범위를 확인한 근거를 남기세요.',
  },
  'B': {
    '발견한 문제': '시장 범위가 같아도 매출액과 거래액을 섞으면 성장률 비교가 성립하지 않습니다. 성장률 계산 전 두 출처의 지표 정의도 일치하는지 확인해야 합니다.',
    '원문 근거와 판단 이유': '1쪽 A기관 표 2는 국내 매출액 1,200억 원, B기관 표 4는 국내 거래액 1,800억 원입니다. 원문에서 지표명과 수치를 함께 발췌해야 합니다. 시장 범위 일치 기준은 유지하고, 다른 보고서에도 적용할 수 있는 지표 정의 검증 기준을 추가해야 합니다.',
  },
  'C': {
    '발견한 문제': '만족 비율의 분모와 적용 대상이 잘못됐습니다. 응답자 10명 중 7명의 만족을 전체 참여자 90% 또는 전사 의견으로 표현할 수 없습니다.',
    '판단 근거': '1쪽 집계표 1은 대상자 20명, 응답자 10명, 만족 7명입니다. 응답자 만족도는 70%, 응답률은 50%입니다. 전사 구성원 조사는 없습니다.',
    '작성자가 할 일': '만족도를 응답자 기준 70%로, 응답률을 50%로 수정하고 전체 참여자나 전사 구성원으로 일반화한 문장을 삭제하세요. 비율의 분자·분모와 조사 대상 범위를 명시하세요.',
  },
}
(OUT/'feedback-copy.json').write_text(json.dumps(feedback, ensure_ascii=False, indent=2), encoding='utf-8')

guide = (ROOT / 'scripts' / 'test-guide-template.md').read_text(encoding='utf-8')
for key, fields in feedback.items():
    message = fields['발견한 문제'] + ('\n\n수정 방향: ' + fields['작성자가 할 일'] if '작성자가 할 일' in fields else '')
    evidence = fields.get('판단 근거', fields.get('원문 근거와 판단 이유', ''))
    block = '### 피드백 한 칸에 붙여넣기\n\n```text\n' + message + '\n```\n\n첨부 근거는 자동 입력됩니다. 아래 내용과 비교해 필요할 때만 수정하세요.\n\n```text\n' + evidence + '\n```'
    guide = guide.replace('{{'+key+'}}', block)
(OUT/'TEST-GUIDE.md').write_text(guide, encoding='utf-8')

# Keep the HTML guide dependency-free; all PDFs stay alongside it in the ZIP.
def markdown_html(text):
    lines=text.splitlines(); out=[]; code=[]; in_code=False; table=False
    def inline(s):
        import re
        s=escape(s)
        s=re.sub(r'\*\*(.+?)\*\*',r'<strong>\1</strong>',s)
        s=re.sub(r'`([^`]+)`',r'<code>\1</code>',s)
        return s
    for line in lines:
        if line.startswith('```'):
            if in_code:
                out.append('<div class="copy-box"><button onclick="copyText(this)">복사</button><pre>'+escape('\n'.join(code))+'</pre></div>'); code=[]
            in_code=not in_code; continue
        if in_code: code.append(line); continue
        if table and not line.startswith('|'): out.append('</tbody></table></div>'); table=False
        if line.startswith('|'):
            if '---' in line: continue
            if not table: out.append('<div class="table-scroll"><table><tbody>'); table=True
            out.append('<tr>'+''.join('<td>'+inline(s.strip())+'</td>' for s in line.strip('|').split('|'))+'</tr>'); continue
        if line.startswith('### '): out.append('<h3>'+inline(line[4:])+'</h3>')
        elif line.startswith('## '):
            anchor='step-'+str(len([x for x in out if x.startswith('<h2')]))
            out.append('<h2 id="'+anchor+'">'+inline(line[3:])+'</h2>')
        elif line.startswith('# '): out.append('<h1>'+inline(line[2:])+'</h1>')
        elif line.startswith('- [ ] '): out.append('<label class="checkline"><input type="checkbox">'+inline(line[6:])+'</label>')
        elif line.startswith('- '): out.append('<p class="bullet">• '+inline(line[2:])+'</p>')
        elif line.strip(): out.append('<p>'+inline(line)+'</p>')
    return '\n'.join(out)

links=''.join('<a download href="'+escape(p.name)+'">'+escape(p.name)+'</a>' for p in sorted(OUT.glob('*.pdf')))
html='''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KHALA 테스트 가이드</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f3f5f5;color:#22313a;font:16px/1.8 "Malgun Gothic",sans-serif}header{background:#145b52;color:white;padding:24px max(28px,calc((100vw - 960px)/2))}header a{color:white}main{max-width:960px;margin:30px auto;background:white;padding:36px 44px;border:1px solid #d8e2df}h1{font-size:30px}h2{margin-top:52px;border-top:1px solid #d8e2df;padding-top:28px;color:#145b52}h3{font-size:17px;margin-top:28px}p{margin:12px 0}code{font-size:14px;background:#eef3f1;padding:2px 5px;border-radius:3px}pre{white-space:pre-wrap;word-break:keep-all;font:15px/1.8 "Malgun Gothic",sans-serif;margin:0}button{cursor:pointer;border:1px solid #a5beb7;padding:6px 14px;border-radius:4px;background:white;color:#145b52}.copy-box{position:relative;padding:45px 18px 18px;background:#eef5f2;border-left:3px solid #176158}.copy-box button{position:absolute;right:10px;top:8px}.files{display:grid;gap:5px;padding:18px;background:#f5f8f7}.files a{color:#145b52}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}td{border:1px solid #d8e2df;padding:10px}tr:first-child{background:#eaf1ee;font-weight:bold}.checkline{display:block;margin:10px 0}.checkline input{margin-right:10px}nav{display:flex;gap:14px;flex-wrap:wrap;margin-top:16px}nav a{color:#145b52} @media print{header,button,nav{display:none}main{border:0;margin:0;padding:0}h2{break-after:avoid}.copy-box{break-inside:avoid}}@media(max-width:700px){main{margin:0;padding:22px}}</style>
<header><strong>KHALA · 처음부터 테스트</strong><br>직원 리뷰 → 상사 경험 → 새 문서 적용 → 업무별 독립 학습<br><a href="http://127.0.0.1:3010" target="_blank">앱 열기 ↗</a></header><main>
<div class="files"><strong>샘플 PDF · 번호 순서대로 사용</strong>'''+links+'''</div><nav><a href="#step-2">A 직원 리뷰</a><a href="#step-3">B 상사 경험</a><a href="#step-5">C 일반 문서</a><a href="#step-6">추가 검증</a></nav>'''+markdown_html(guide)+'''</main><script>async function copyText(button){const value=button.parentElement.querySelector('pre').textContent;try{await navigator.clipboard.writeText(value)}catch{const t=document.createElement('textarea');t.value=value;document.body.append(t);t.select();document.execCommand('copy');t.remove()}button.textContent='복사됨';setTimeout(()=>button.textContent='복사',1400)}</script></html>'''
(OUT/'START-HERE.html').write_text(html, encoding='utf-8')
with zipfile.ZipFile(OUT.parent/'khala-test-kit.zip','w',zipfile.ZIP_DEFLATED) as z:
    for path in sorted(OUT.iterdir()):
        if path.is_file(): z.write(path, path.name)
print(json.dumps({'directory':str(OUT),'pdf_count':len(list(OUT.glob('*.pdf'))),'guide':'START-HERE.html'},ensure_ascii=False))
