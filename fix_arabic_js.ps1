# Fix all corrupted Arabic strings in timetable.html JavaScript section
$content = Get-Content 'd:\project 06\timetable.html' -Raw -Encoding UTF8

# === Theme toggle ===
$content = $content.Replace("newTheme === 'dark' ? '?? إلغاء إلغاء إلغاء?' : '?? إلغاء إلغاء إلغاء?'", "newTheme === 'dark' ? 'تم تفعيل الوضع الداكن' : 'تم تفعيل الوضع الفاتح'")

# === Search results "no results" ===
$content = $content.Replace("?? حفظ? إلغاء</div>", "لا توجد نتائج</div>")
$content = $content.Replace("?? حفظ? إلغاء?</div>", "لا توجد نتائج</div>")

# === selectSearchResult ===
$content = $content.Replace("showToast(``?? ?المادة: ", "showToast(``تم اختيار: ")

# === performRedo ===
$content = $content.Replace("?? ??وضع التعديل'", "تم إعادة التغيير'")

# === openPrintPreview error ===
$content = $content.Replace("?? حفظ? ?وضع التعديل?'", "لا يوجد جدول للمعاينة'")

# === clearSelectedCells ===
$content = $content.Replace("?? حفظ ${selected.length} إلغاء'", "تم مسح ${selected.length} خانة'")

# === showChangesDiff no original ===
$content = $content.Replace("?? حفظ? حفظ? جدول الأساتذة'", "لا توجد بيانات أصلية للمقارنة'")

# === loadSavedData file-stats ===
$content = $content.Replace("إلغاء? ?المادة: ${fetData.teachers.length} إلغاء", "البيانات المحملة: ${fetData.teachers.length} أستاذ")

# === loadSavedData success toast ===
$content = $content.Replace("?? ?القائمة الجانبية? إلغاءحفظ'", "تم تحميل البيانات المحفوظة بنجاح'")

# === clearSavedData ===
$content = $content.Replace("?? حفظ ??القائمة الجانبية?'", "تم مسح البيانات المحفوظة'")

# === setupEventListeners - file type error ===
$content = $content.Replace("حفظ? إلغاء? حفظ XML ?? FET حفظ?'", "يرجى اختيار ملف XML أو FET فقط'")

# === handleFile loading toast ===
$content = $content.Replace("حفظ? إلغاء إلغاء...'", "جاري معالجة الملف...'")

# === handleFile error ===
$content = $content.Replace("حفظ حفظ إلغاء. ?وضع التعديل حفظ _teachers.xml ?? .fet'", "صيغة غير مدعومة. يرجى استخدام _teachers.xml أو .fet'")

# === handleFile success ===
$content = $content.Replace("?? إلغاء ${fetData.teachers.length} إلغاء'", "تم تحميل ${fetData.teachers.length} أستاذ'")

# === handleFile file stats ===
$content = $content.Replace("${fetData.teachers.length} إلغاء |", "${fetData.teachers.length} أستاذ |")
$content = $content.Replace("${fetData.subjects.size || fetData.subjects.length || 0} حفظ?", "${fetData.subjects.size || fetData.subjects.length || 0} مادة")

# === handleFile parse error ===
$content = $content.Replace("حفظ ?? إلغاء المادة: '", "خطأ في المعالجة: '")

# === subject filter toast ===
$content = $content.Replace("${teachersWithSubject.length} إلغاء إلغاء? حفظ إلغاء?'", "${teachersWithSubject.length} أستاذ يدرسون هذه المادة'")

# === level filter toast ===
$content = $content.Replace("${filteredClasses.length} حفظ ?? وضع التعديل'", "${filteredClasses.length} قسم في هذا المستوى'")

# === FET file no schedule warning ===
$content = $content.Replace("حفظ FET ?? إلغاء حفظ حفظ? حفظ?. حفظ? إلغاء حفظ _teachers.xml ?? إلغاء? FET حفظ ?? إلغاء?.'", "ملف FET لا يحتوي على جدول زمني. يرجى استخدام ملف _teachers.xml أو تصدير FET مع الجدول.'")

# === parseFetFile success ===
$content = $content.Replace("?? إلغاء ${totalScheduled} حفظ إلغاء?'", "تم تحميل ${totalScheduled} حصة بنجاح'")

# === updateStats status ===
$content = $content.Replace("Object.keys(fetData.timetables).length > 0 ? 'إلغاء' : 'حفظ إلغاء'", "Object.keys(fetData.timetables).length > 0 ? 'نشط' : 'غير محمل'")

# === dayKeywords in parseFetFile ===
$content = $content.Replace("'lundi': 'إلغاء??', 'monday': 'إلغاء??', 'إلغاء??': 'إلغاء??',", "'lundi': 'الاثنين', 'monday': 'الاثنين', 'الاثنين': 'الاثنين',")
$content = $content.Replace("'mardi': 'إلغاءحفظ', 'tuesday': 'إلغاءحفظ', 'إلغاءحفظ': 'إلغاءحفظ',", "'mardi': 'الثلاثاء', 'tuesday': 'الثلاثاء', 'الثلاثاء': 'الثلاثاء',")
$content = $content.Replace("'mercredi': 'إلغاءحفظ', 'wednesday': 'إلغاءحفظ', 'إلغاءحفظ': 'إلغاءحفظ',", "'mercredi': 'الأربعاء', 'wednesday': 'الأربعاء', 'الأربعاء': 'الأربعاء',")
$content = $content.Replace("'jeudi': 'إلغاء?', 'thursday': 'إلغاء?', 'إلغاء?': 'إلغاء?',", "'jeudi': 'الخميس', 'thursday': 'الخميس', 'الخميس': 'الخميس',")
$content = $content.Replace("'vendredi': 'إلغاء?', 'friday': 'إلغاء?', 'إلغاء?': 'إلغاء?',", "'vendredi': 'الجمعة', 'friday': 'الجمعة', 'الجمعة': 'الجمعة',")
$content = $content.Replace("'samedi': 'إلغاء', 'saturday': 'إلغاء', 'إلغاء': 'إلغاء',", "'samedi': 'السبت', 'saturday': 'السبت', 'السبت': 'السبت',")
$content = $content.Replace("'dimanche': 'إلغاء', 'sunday': 'إلغاء', 'إلغاء': 'إلغاء'", "'dimanche': 'الأحد', 'sunday': 'الأحد', 'الأحد': 'الأحد'")

# === renderTeacherTimetable error ===
$content = $content.Replace("?? حفظ? حفظ? حفظ? ?وضع التعديل. إلغاء? حفظ _teachers.xml'", "لا توجد بيانات جدول لهذا الأستاذ. يرجى استخدام ملف _teachers.xml'")

# === Period cells (ص = صباحاً, م = مساءً) ===
$content = $content.Replace("${period} ?</td>", "${period} ص</td>")
$content = $content.Replace("${period} ?</td>", "${period} م</td>")

# === Separator row ===
# Keep الرئيسية as is (it's actually "استراحة" = break but keeping existing)

# === Color legend title ===
$content = $content.Replace("حفظ? ??المادة:</div>", "دليل الألوان:</div>")

# === Summary title in teacher timetable ===
$content = $content.Replace("<div class=""summary-title""><i class=""fas fa-chart-pie""></i> حفظ? ?المادة:</div>", "<div class=""summary-title""><i class=""fas fa-chart-pie""></i> ملخص الجدول:</div>")

# === Summary labels ===
$content = $content.Replace("<span class=""label"">?القائمة الجانبية</span>", "<span class=""label"">الأقسام</span>")
$content = $content.Replace("<span class=""label"">??وضع التعديل</span>", "<span class=""label"">مجموع الحصص</span>")
$content = $content.Replace("${teacherClasses.size} حفظ</span>", "${teacherClasses.size} قسم</span>")
$content = $content.Replace("${totalHours} حفظ?/إلغاء</span>", "${totalHours} ساعة/أسبوع</span>")

# === Student timetable summary ===
$content = $content.Replace("<span class=""label"">حفظ إلغاء?</span>", "<span class=""label"">عدد المواد</span>")
$content = $content.Replace("${classSubjects.size} حفظ?</span>", "${classSubjects.size} مادة</span>")
$content = $content.Replace("القائمة الجانبية??:</div>", "المواد والأساتذة:</div>")

# === Teacher names separator ===
$content = $content.Replace(".join('? ')", ".join('، ')")

# === toggleEditMode error ===
$content = $content.Replace("حفظ? إلغاء? إلغاء إلغاء'", "يرجى اختيار أستاذ أولاً'")

# === Edit mode buttons ===
$content = $content.Replace("وضع التعديل إلغاء?'", "تم تفعيل وضع التعديل'")

# === Drag handle title ===
$content = $content.Replace("حفظ? حفظ? إلغاء'", "اسحب للنقل'")

# === Edit modal selects ===
$content = $content.Replace("-- حفظ? حفظ? --", "-- اختر المادة --")
$content = $content.Replace("-- حفظ? حفظ --", "-- اختر القسم --")

# === confirmSlotEdit success ===
$content = $content.Replace("?? ??وضع التعديل إلغاء?'", "تم تسجيل التغيير بنجاح'")

# === Slot highlighting titles ===
$content = $content.Replace("إلغاء المادة: ${classHasActivity.subject}", "مشغول: ${classHasActivity.subject}")
$content = $content.Replace("إلغاء?? المادة: ${teacherHasActivity.subject}", "الأستاذ مشغول: ${teacherHasActivity.subject}")
$content = $content.Replace("حفظ حفظ?: إلغاء حفظ? ?? حفظ? إلغاء (حفظ? إلغاء حفظ إلغاء)'", "غير متاح: سيتسبب في فراغ (ساعات غير متتالية)'")
$content = $content.Replace("حفظ? إلغاء (جدول الأساتذة إلغاء?)'", "متاح للحصة (القسم والأستاذ متاحان)'")

# === Validation messages ===
$content = $content.Replace("حفظ إلغاء? إلغاء? إلغاء?'", "يرجى اختيار المادة والقسم'")
$content = $content.Replace("المادة: حفظ إلغاء حفظ? حفظ إلغاء? إلغاء? ?? حفظ إلغاء'", "تنبيه: هذه المادة موجودة بالفعل في جدول هذا القسم في نفس اليوم'")
$content = $content.Replace("حفظ: إلغاء? ${room} إلغاء? ?? حفظ ${roomCheck.byTeacher}", "تعارض: القاعة ${room} مشغولة من طرف ${roomCheck.byTeacher}")
$content = $content.Replace("حفظ: إلغاء حفظ? القائمة الجانبية (7 إلغاء/حفظ)'", "خطأ: تجاوز الحد الأقصى للحصص (7 ساعات/يوم)'")
$content = $content.Replace("المادة: ?? حفظ? حفظ إلغاء? ?? ?وضع التعديل'", "تنبيه: قد يتسبب الحذف في فراغ بالجدول'")

# === Undo ===
$content = $content.Replace("?? إلغاء?? ?? حفظ إلغاء'", "تم التراجع عن آخر تغيير'")

# === Cancel edit mode ===
$content = $content.Replace("?? حفظ? إلغاء حفظ? حفظالقائمة الجانبية?'", "هل تريد إلغاء جميع التعديلات المعلقة؟'")
$content = $content.Replace("?? إلغاء وضع التعديل'", "تم إلغاء وضع التعديل'")

# === Diff mode ===
$content = $content.Replace("جدول الأساتذة?'", "إخفاء التغييرات'")
$content = $content.Replace("حفظ وضع التعديل?? إلغاء?'", "تم تفعيل وضع المقارنة'")
$content = $content.Replace("وضع التعديل??'", "عرض التغييرات'")
$content = $content.Replace("?? إلغاء وضع التعديل??'", "تم إلغاء وضع المقارنة'")

# === Save changes ===
$content = $content.Replace("?? ?وضع التعديل إلغاء'", "لا توجد تعديلات للحفظ'")
$content = $content.Replace("?? حفظ ${editMode.changeHistory.length} إلغاء إلغاء'", "تم حفظ ${editMode.changeHistory.length} تعديل بنجاح'")

# === Changelog modal empty ===
$content = $content.Replace("?? ?وضع التعديل إلغاء", "لا توجد تعديلات حتى الآن")

# === Changelog change types ===
$content = $content.Replace("change.type === 'add' ? 'إلغاء' : change.type === 'edit' ? 'إلغاء' : 'حفظ'", "change.type === 'add' ? 'إضافة' : change.type === 'edit' ? 'تعديل' : 'حذف'")

# === Export changelog ===
$content = $content.Replace("?? حفظ? ?القائمة الجانبية?'", "لا توجد تعديلات للتصدير'")
$content = $content.Replace("const headers = ['إلغاء?? إلغاء?', 'إلغاء', 'إلغاء??', 'إلغاء?', 'إلغاء', 'إلغاء', 'إلغاء']", "const headers = ['التاريخ والوقت', 'النوع', 'الأستاذ', 'المادة', 'القسم', 'اليوم', 'الحصة']")
$content = $content.Replace("change.type === 'add' ? 'إلغاء' : change.type === 'edit' ? 'إلغاء' : 'حفظ',", "change.type === 'add' ? 'إضافة' : change.type === 'edit' ? 'تعديل' : 'حذف',")
$content = $content.Replace("link.download = ``حفظ_إلغاءحفظ?_", "link.download = ``سجل_التعديلات_")
$content = $content.Replace("?? إلغاء وضع التعديل??'", "تم تصدير سجل التعديلات'")

# === Export JSON ===
$content = $content.Replace("link.download = ``إلغاء??_إلغاء?_", "link.download = ``تعديلات_الجدول_")
$content = $content.Replace("?? جدول الأساتذة? حفظ? JSON'", "تم تصدير التعديلات كملف JSON'")

# === Import JSON ===
$content = $content.Replace("حفظ حفظ حفظ?'", "ملف غير صالح'")
$content = $content.Replace("?? حفظ?:\\n- المادة: وضع التعديل?? ?? إلغاءحفظ\\n- المادة: إلغاء?? ?وضع التعديل??'", "اختر الإجراء:\\n- موافق: دمج التعديلات مع الحالية\\n- إلغاء: استبدال التعديلات الحالية'")
$content = $content.Replace("?? حفظ ${data.changeHistory.length} إلغاء'", "تم دمج ${data.changeHistory.length} تعديل'")
$content = $content.Replace("?? إلغاء?? ${data.changeHistory.length} إلغاء'", "تم استبدال ${data.changeHistory.length} تعديل'")
$content = $content.Replace("حفظ ?? إلغاء إلغاء'", "خطأ في استيراد الملف'")

# === Change summary bar ===
$content = $content.Replace("حفظ? حفظ?المادة:", "ملخص التغييرات:")
$content = $content.Replace("${added} إلغاء</span>", "${added} إضافة</span>")
$content = $content.Replace("${modified} إلغاء</span>", "${modified} تعديل</span>")
$content = $content.Replace("${deleted} حفظ</span>", "${deleted} حذف</span>")

# === Drag and drop toasts ===
$content = $content.Replace("حفظ? ${slotData.subject} (${slotData.students}) حفظ إلغاء? إلغاء?'", "جاري نقل ${slotData.subject} (${slotData.students}) - أفلت في الخانة المطلوبة'")
$content = $content.Replace("حفظ? ${slotData.subject} (${slotData.class}) حفظ إلغاء? إلغاء?'", "جاري نقل ${slotData.subject} (${slotData.class}) - أفلت في الخانة المطلوبة'")
$content = $content.Replace("حفظ? إلغاء حفظ إلغاء? إلغاء?'", "جاري نقل الحصة - أفلت في الخانة المطلوبة'")
$content = $content.Replace("?? حفظ إلغاء إلغاء? - ?وضع التعديل?? إلغاء? إلغاء'", "تم نقل الحصة بنجاح - تذكر حفظ التغييرات'")
$content = $content.Replace("?? حفظ? المادة: '", "لا يمكن النقل: '")

# === Period type detection in JS (ص/م markers) ===
$content = $content.Replace("periodRaw.includes('?') ? 'morning' : 'afternoon'", "periodRaw.includes('ص') ? 'morning' : 'afternoon'")
$content = $content.Replace(".replace(/\s*(?|?)\s*$/g, '')", ".replace(/\s*[صم]\s*$/g, '')")
$content = $content.Replace("periodType === 'morning' ? '?' : '?'", "periodType === 'morning' ? 'ص' : 'م'")

# === Separator row text ===
$content = $content.Replace("<span>الرئيسية</span>", "<span>استراحة</span>")

# Write the file back
Set-Content -Path 'd:\project 06\timetable.html' -Value $content -Encoding UTF8 -NoNewline

Write-Host "All Arabic string replacements applied successfully!"
