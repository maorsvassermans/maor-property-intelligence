# הפעלה ב-GitHub Codespaces

## 1. העלאת הפרויקט

1. פתחו Repository חדש ב-GitHub.
2. חלצו את קובץ הפרויקט והעלו את תוכנו לשורש ה-Repository.
3. ודאו שהתיקיות `.devcontainer` ו-`.github` הועלו יחד עם שאר הקבצים.

## 2. הגדרת סודות

ב-GitHub היכנסו אל Settings, לאחר מכן Secrets and variables, ואז Codespaces. צרו Secret בשם `APIFY_TOKEN` עם ה-Token מחשבון Apify.

לסריקות המתוזמנות היכנסו גם אל Actions secrets והגדירו:

- `APIFY_TOKEN`
- `ALERT_WEBHOOK_URL`, רק אם רוצים שליחה לשירות חיצוני

אין לשמור Token בתוך `.env` שמועלה ל-Git.

## 3. פתיחת Codespace

1. חזרו לעמוד הראשי של ה-Repository.
2. לחצו Code.
3. עברו ללשונית Codespaces.
4. לחצו Create codespace on main.

הסביבה תפעיל Node.js 24, תיצור נתוני דוגמה ותריץ את הבדיקות.

## 4. הפעלת המערכת

ב-Terminal:

```bash
npm start
```

פורט 3000 ייפתח אוטומטית. אם אינו נפתח, עברו ללשונית Ports ולחצו על כתובת פורט 3000.

## 5. בדיקה ידנית של Apify

```bash
npm run scan
```

אם מתקבלת הודעה `APIFY_TOKEN is missing`, ה-Secret לא הוזרק ל-Codespace הנוכחי. לאחר הוספת Secret יש ליצור Codespace חדש או לייצא את המשתנה ידנית רק לאותו Session.

## 6. סריקה אוטומטית

Workflow בשם `Property scan` מופעל בדקה 17 בכל שעה. אפשר להריץ אותו גם ידנית דרך לשונית Actions. מסד הנתונים נשמר בין הרצות באמצעות Cache כדי לאפשר השוואת מחיר קודם למחיר חדש.

GitHub Cache עלול להימחק ואינו מסד נתונים מסחרי. לאחר הוכחת ה-MVP יש להעביר את הנתונים ל-PostgreSQL או למסד מנוהל אחר.
