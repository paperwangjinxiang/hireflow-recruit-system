"""生成图片型（扫描件风格）测试简历 PDF：整页就是一张图，没有文字层"""
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as rl_canvas
import os

WS = r"D:\HuaweiMoveData\Users\52981\Documents\Kimi\Workspaces\网站开发"
OUT_IMG = os.path.join(WS, "扫描简历-王慧敏.png")
OUT_PDF = os.path.join(WS, "扫描简历-王慧敏.pdf")

FONT = r"C:\Windows\Fonts\simhei.ttf"
if not os.path.exists(FONT):
    FONT = r"C:\Windows\Fonts\msyh.ttc"

LINES = [
    ("王慧敏", 44),
    ("", 20),
    ("电话：13912345678    邮箱：wanghuimin@example.com", 24),
    ("年龄：29岁    籍贯：湖北黄冈", 24),
    ("求职意向：高中数学教师", 24),
    ("", 20),
    ("教育经历", 28),
    ("2013.09 - 2017.06  华中师范大学  数学与应用数学专业  本科（全日制）", 24),
    ("2017.09 - 2020.06  华中师范大学  课程与教学论  硕士（全日制）", 24),
    ("2020年毕业", 24),
    ("", 20),
    ("工作经历", 28),
    ("2020.08 - 至今  黄冈中学  高中数学教师  5年教学经验", 24),
    ("负责高三数学教学与班主任工作，擅长竞赛辅导与教学设计", 24),
    ("", 20),
    ("证书资质", 28),
    ("高级中学数学教师资格证    普通话二级甲等    CET-6", 24),
    ("", 20),
    ("教学技能", 28),
    ("教学设计、班级管理、中高考备考、分层教学、家校沟通", 24),
]

W, H = 1240, 1754  # A4 @150dpi
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
y = 60
for text, size in LINES:
    font = ImageFont.truetype(FONT, size)
    d.text((70, y), text, fill=(30, 30, 30), font=font)
    y += size + 18

img.save(OUT_IMG)

c = rl_canvas.Canvas(OUT_PDF, pagesize=A4)
aw, ah = A4
c.drawImage(OUT_IMG, 0, 0, width=aw, height=ah)
c.showPage()
c.save()
print("生成完成:", OUT_PDF, os.path.getsize(OUT_PDF), "bytes")
