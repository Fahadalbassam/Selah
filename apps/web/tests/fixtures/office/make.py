"""Builds the Office files the import tests read, with the libraries real
spreadsheets and documents usually come from (openpyxl, python-docx).
Run from this folder: python3 make.py"""
import datetime
import openpyxl
from docx import Document

wb = openpyxl.Workbook()
notes = wb.active
notes.title = "تعليمات"
notes["A1"] = "املأ الخطة في الورقة التالية."
plan = wb.create_sheet("الخطة")
plan.sheet_view.rightToLeft = True
plan["A1"] = "خطة التنفيذ"
plan.append(["الملاحظة", "التوصية", "الأولوية", "الإجراء", "المسؤول", "تاريخ الاستحقاق", "قائمة الأدلة", "الحالة"])
rows = [
    ["لا يوجد ميثاق لمجلس الإدارة", "اعتماد ميثاق لمجلس الإدارة", "عالية", "إعداد مسودة الميثاق", "عبدالله", datetime.date(2027, 3, 15), "مسودة الميثاق\nمحضر الاعتماد", "قيد التنفيذ"],
    [None, None, None, "اعتماد الميثاق من المجلس", "Reem Al-Qahtani", "١٥/٠٩/١٤٤٨هـ", "محضر الاجتماع؛ قرار المجلس", None],
    [None, "تشكيل لجنة المراجعة", "حرجة", "تسمية أعضاء اللجنة", "someone unknown", "2027-13-40", None, None],
    [None, None, None, None, None, None, None, None],
    ["Conflicts of interest are not declared", "Adopt a conflict of interest policy", "high", "Draft the policy", "abdullah@nukhba.example", "٢٠٢٧/٠٤/٠١", "Policy draft", None],
]
for r in rows:
    plan.append(r)
plan["F3"].number_format = "yyyy-mm-dd"
plan.merge_cells("A3:A5")
hidden = wb.create_sheet("hidden")
hidden["A1"] = "secret"
hidden.sheet_state = "hidden"
wb.save("plan-ar.xlsx")

doc = Document()
doc.add_heading("تقرير الحوكمة", level=0)
doc.add_heading("1. لا يوجد ميثاق لمجلس الإدارة", level=1)
doc.add_paragraph("رصد الفريق غياب ميثاق معتمد.")
doc.add_heading("1.1 اعتماد ميثاق لمجلس الإدارة", level=2)
doc.add_paragraph("الميثاق يحدد صلاحيات المجلس.")
doc.add_paragraph("إعداد مسودة الميثاق", style="List Bullet")
doc.add_paragraph("اعتماد الميثاق من المجلس", style="List Bullet")
doc.add_paragraph("خلال ثلاثة أشهر.")
doc.add_heading("1.2 Adopt a conflict of interest policy", level=2)
doc.add_heading("2. Committees", level=1)
table = doc.add_table(rows=1, cols=4)
for cell, text in zip(table.rows[0].cells, ["Recommendation", "Action", "Owner", "Due date"]):
    cell.text = text
for values in [["Form an audit committee", "Name the members", "Reem", "2027-05-01"], ["", "Approve the committee charter", "Reem", "01/06/2027"]]:
    cells = table.add_row().cells
    for cell, text in zip(cells, values):
        cell.text = text
doc.save("plan-outline.docx")
