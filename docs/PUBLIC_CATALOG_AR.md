# تحديث كتالوج الخدمات والأسعار في GitHub

يحفظ سير العمل **Refresh public provider catalog** أسعار الأرقام الافتراضية وقوائم خدمات SMM العامة في فرع مستقل `provider-catalog`. يعمل عند الدقيقة 7 و37 من كل ساعة، ويمكن تشغيله يدويًا من Actions. توقيت GitHub تقريبي وقد يتأخر، والبوت يحتفظ أيضًا بتحديثاته المباشرة كل 30 دقيقة.

الفرع مستقل عن `main` لكي لا يؤدي تحديث الأسعار إلى إعادة نشر البوت في Render. يحتوي فقط على:

| الملف | المحتوى |
| --- | --- |
| `catalog/virtual-number-cache.json` | تكاليف الأرقام المتاحة وأعدادها، مع معرفات الدول وبياناتها العامة |
| `catalog/smm-services.json` | الخدمات المسموح بها وأسعارها وحدودها العامة |
| `catalog/status.json` | وقت الفحص وحالة تحديث كل مزود |

**لا تحفظ هذه العملية الأرصدة أو العملاء أو الطلبات أو الأرقام المشتراة أو رسائل SMS أو رموز API في GitHub.** كتالوج الأسعار ليس نسخة احتياطية لمحفظة العميل.

## تفعيل التحديث الخارجي

من المستودع: **Settings → Secrets and variables → Actions → New repository secret**. انسخ القيم من إعداداتك الحالية دون وضعها في ملفات المستودع:

| اسم Secret | القيمة |
| --- | --- |
| `HERO_SMS_API_KEY` | مفتاح HeroSMS؛ مطلوب لتحديث هذا المزود |
| `GRIZZLY_API_KEY` | مفتاح Grizzly؛ مطلوب لتحديث هذا المزود |
| `SMM_API_KEY` | مفتاح موقع خدمات SMM |
| `SMM_API_URL` | عنوان HTTPS النهائي لواجهة SMM، دون مفتاح أو معاملات في الرابط |
| `HERO_BASE_URLS` | اختياري: عناوين HTTPS بديلة مفصولة بفواصل |
| `GRIZZLY_BASE_URLS` | اختياري: عناوين HTTPS بديلة مفصولة بفواصل |

بعد رفع سير العمل إلى `main`، افتح **Actions → Refresh public provider catalog → Run workflow**. يظهر التقرير `updated` عند نجاح استدعاءات الأسعار؛ `missing_configuration` عند غياب المفاتيح؛ `unavailable` عند فشل الاتصال أو استجابة غير صالحة. غياب مفاتيح GitHub لا يمنع تشغيل البوت بمفاتيح Render.

عند فشل المزود تبقى آخر أسعار ناجحة بتاريخها الأصلي؛ لا تُنشأ أسعار افتراضية ولا يوضع تاريخ جديد على الأسعار القديمة. لا تُنشر ملفات فارغة إذا فشلت جميع الطلبات. شراء رقم وتأكيد توفره يتمان من المزود مباشرة وقت الشراء، ويعرض البوت حالة السعر القديم عند استخدام نسخة مخبأة.

يدعم البوت قراءة الكتالوج العام في الخلفية عبر `VAULTX_PUBLIC_CATALOG_URL` و`VAULTX_PUBLIC_SMM_CATALOG_URL`، مع الروابط الافتراضية في المستودع. العملية لا تنتظر GitHub عند ضغط المستخدم على الأزرار.

قد يعطّل GitHub الجداول في المستودعات العامة بعد 60 يومًا من عدم النشاط؛ أعد تفعيلها من Actions عند الحاجة. مراجع التنفيذ: [الجدولة](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)، [صلاحيات GITHUB_TOKEN](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).
