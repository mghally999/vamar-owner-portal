"""
Builds vamar-import-template.xlsx: the sheet Vamar fills in to load its real data through the
dashboard's Import page.

  python tooling/golive/make_import_template.py

Writes apps/dashboard/public/vamar-import-template.xlsx (downloadable from the Import page).
Each data sheet's headers start with the field key, so the Import page maps every column by
itself. Lists, number ranges and lengths are enforced by Excel data validation; the dashboard
validates again before anything is saved.
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "dashboard" / "public" / "vamar-import-template.xlsx"

SLATE = "25323A"
MIST = "E8E8E8"
HEADER_FONT = Font(name="Almarai", bold=True, color="FFFFFF")
HEADER_FILL = PatternFill("solid", fgColor=SLATE)
NOTE_FONT = Font(name="Almarai", italic=True, color="4C575E", size=10)
BODY_FONT = Font(name="Almarai")
UNIT_TYPES = ["apartment", "villa", "shop", "office", "warehouse", "other"]
ROWS = 5000  # validation applies to this many rows

SHEETS = {
    "Owners": [
        ("nameAr", "الاسم بالعربي", "مطلوب", 28),
        ("nameEn", "Name in English", "مطلوب", 28),
        ("phoneE164", "الجوال، مثل 0501234567 أو +971501234567", "مطلوب، رقم الدخول للتطبيق", 26),
        ("email", "البريد الإلكتروني", "اختياري", 28),
        ("preferredLang", "لغة التطبيق: ar أو en", "اختياري، ar إذا ترك فارغاً", 18),
    ],
    "Buildings": [
        ("nameAr", "اسم المبنى بالعربي", "مطلوب، يكتب في ورقة الوحدات كما هو", 28),
        ("nameEn", "Building name in English", "مطلوب", 28),
        ("area", "المنطقة، مثل ديرة", "مطلوب", 20),
        ("address", "العنوان", "اختياري", 36),
    ],
    "Units": [
        ("building", "اسم المبنى كما في ورقة المباني (عربي أو إنجليزي)", "مطلوب", 30),
        ("unitNo", "رقم الوحدة، مثل 1204 أو G-02", "مطلوب، لا يتكرر في نفس المبنى", 18),
        ("type", "النوع: apartment / villa / shop / office / warehouse / other", "اختياري، apartment إذا ترك فارغاً", 22),
        ("bedrooms", "عدد غرف النوم (0 إلى 20)", "اختياري", 16),
        ("sizeSqft", "المساحة بالقدم المربع", "اختياري", 16),
    ],
    "Tenants": [
        ("name", "اسم المستأجر أو الشركة", "مطلوب", 30),
        ("phone", "الجوال", "اختياري", 20),
        ("email", "البريد الإلكتروني", "اختياري", 28),
        ("company", "اسم الشركة إن وجد", "اختياري", 28),
    ],
}

EXAMPLES = {
    "Owners": ["خالد المنصوري", "Khalid Al Mansoori", "+971501234567", "khalid@example.com", "ar"],
    "Buildings": ["برج النور", "Al Noor Tower", "ديرة", "شارع المطار، دبي"],
    "Units": ["برج النور", "1204", "apartment", 2, 1150],
    "Tenants": ["سارة خليل", "+971559876543", "", ""],
}


def instructions(ws):
    ws.sheet_view.rightToLeft = True
    ws.column_dimensions["A"].width = 110
    lines = [
        ("نموذج استيراد بيانات فامار", Font(name="Almarai", bold=True, size=16, color=SLATE)),
        ("", None),
        ("طريقة الاستخدام", Font(name="Almarai", bold=True, size=13, color=SLATE)),
        ("1. املأ الأوراق بالترتيب: الملاك، ثم المباني، ثم الوحدات، ثم المستأجرين. صف واحد لكل سجل، ابتداءً من الصف الثاني.", BODY_FONT),
        ("2. لا تغيّر الصف الأول (أسماء الأعمدة) ولا تحذفه. مرّر المؤشر على اسم العمود لرؤية شرحه، والشرح نفسه في الأسفل.", BODY_FONT),
        ("3. في لوحة التحكم افتح «استيراد»، اختر الملف، ثم اختر الورقة ونوع البيانات. تُطابق الأعمدة تلقائياً.", BODY_FONT),
        ("4. راجع نتيجة الفحص: الصفوف السليمة تُستورد، والصفوف التي فيها أخطاء تظهر مع السبب لتصحيحها ثم رفعها مرة أخرى.", BODY_FONT),
        ("5. رفع نفس الملف مرتين لا يكرر البيانات: يظهر لك نتيجة الاستيراد السابق.", BODY_FONT),
        ("", None),
        ("قواعد مهمة", Font(name="Almarai", bold=True, size=13, color=SLATE)),
        ("• رقم الجوال هو رقم دخول المالك إلى التطبيق. أرقام الإمارات تقبل بأي صيغة: 0501234567 أو 971501234567 أو +971501234567.", BODY_FONT),
        ("• اسم المبنى في ورقة الوحدات يجب أن يطابق اسمه في ورقة المباني (العربي أو الإنجليزي).", BODY_FONT),
        ("• حصص الملاك في الوحدات المشتركة، والعقود والشيكات، تُدخل من لوحة التحكم بعد الاستيراد (شاشة الوحدة ثم «تعيين الملاك»، وشاشة العقود).", BODY_FONT),
        ("• حتى 5,000 صف في كل ورقة. الملف الأكبر يقسّم إلى ملفات.", BODY_FONT),
        ("", None),
        ("شرح الأعمدة", Font(name="Almarai", bold=True, size=13, color=SLATE)),
    ]
    for i, (text, font) in enumerate(lines, start=1):
        cell = ws.cell(row=i, column=1, value=text)
        if font:
            cell.font = font
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    row = len(lines) + 1
    for name, cols in SHEETS.items():
        ws.cell(row=row, column=1, value=f"{name}: " + " · ".join(
            f"{key}: {hint} ({rule})" for key, hint, rule, _w in cols
        )).alignment = Alignment(wrap_text=True)
        row += 1
    row += 1
    ws.cell(row=row, column=1, value="أمثلة (لا تنسخها إلى الأوراق)").font = Font(name="Almarai", bold=True, size=13, color=SLATE)
    row += 1
    for name, cols in SHEETS.items():
        ws.cell(row=row, column=1, value=f"{name}: " + " | ".join(
            f"{key}={value}" for (key, *_), value in zip(cols, EXAMPLES[name])
        )).font = NOTE_FONT
        row += 1


def data_sheet(wb, name, cols):
    ws = wb.create_sheet(name)
    ws.freeze_panes = "A2"
    for c, (key, hint, rule, width) in enumerate(cols, start=1):
        head = ws.cell(row=1, column=c, value=key)
        head.font = HEADER_FONT
        head.fill = HEADER_FILL
        head.alignment = Alignment(horizontal="center")
        head.comment = Comment(f"{hint}\n{rule}", "Vamar", width=260, height=90)
        ws.column_dimensions[head.column_letter].width = width
    last = ROWS + 1

    def col(key):
        for c, (k, *_rest) in enumerate(cols, start=1):
            if k == key:
                return ws.cell(row=1, column=c).column_letter
        raise KeyError(key)

    def add(dv, key):
        ws.add_data_validation(dv)
        dv.add(f"{col(key)}2:{col(key)}{last}")

    required_text = lambda title: DataValidation(  # noqa: E731
        type="textLength", operator="between", formula1="1", formula2="200",
        allow_blank=True, showErrorMessage=True, errorTitle=title,
        error="النص طويل جداً (200 حرف كحد أقصى).",
    )
    if name == "Owners":
        add(required_text("الاسم"), "nameAr")
        add(required_text("Name"), "nameEn")
        add(DataValidation(type="textLength", operator="between", formula1="9", formula2="16",
                           allow_blank=True, showErrorMessage=True, errorTitle="الجوال",
                           error="رقم الجوال بين 9 و16 خانة، مثل 0501234567."), "phoneE164")
        add(DataValidation(type="list", formula1='"ar,en"', allow_blank=True,
                           showErrorMessage=True, errorTitle="اللغة", error="اختر ar أو en."),
            "preferredLang")
    if name == "Buildings":
        add(required_text("الاسم"), "nameAr")
        add(required_text("Name"), "nameEn")
    if name == "Units":
        add(DataValidation(type="list", formula1='"' + ",".join(UNIT_TYPES) + '"', allow_blank=True,
                           showErrorMessage=True, errorTitle="النوع", error="اختر نوعاً من القائمة."),
            "type")
        add(DataValidation(type="whole", operator="between", formula1="0", formula2="20",
                           allow_blank=True, showErrorMessage=True, errorTitle="غرف النوم",
                           error="رقم صحيح من 0 إلى 20."), "bedrooms")
        add(DataValidation(type="whole", operator="between", formula1="1", formula2="1000000",
                           allow_blank=True, showErrorMessage=True, errorTitle="المساحة",
                           error="رقم صحيح أكبر من صفر."), "sizeSqft")
    if name == "Tenants":
        add(required_text("الاسم"), "name")


def main():
    wb = Workbook()
    ws = wb.active
    ws.title = "اقرأني"
    instructions(ws)
    for name, cols in SHEETS.items():
        data_sheet(wb, name, cols)
    wb.properties.creator = "Vamar Real Estate"
    wb.properties.title = "Vamar import template"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
