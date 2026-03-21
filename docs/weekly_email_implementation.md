# Weekly Email Reports – How They Work and How to Implement

## Current State

- **Settings UI**: The app has a **Weekly Email Reports** toggle in **Settings → Notifications**. When enabled, the value `enable_emails: true` is saved to the user’s row in the `settings` table (via `context/DataContext.tsx` and the `settings` Supabase table).
- **No sending yet**: There is **no backend** that runs on a schedule, reads this preference, or sends email. The feature is “preference only” until you add a scheduled job and an email sender.

So today:
- **How will the email be sent weekly?** → It isn’t sent yet. You need to add a scheduled job (see below) that runs weekly and calls an email-sending function.
- **How will the template look?** → The HTML template exists at `docs/weekly_email_template.html`. Use it as the email body when implementing the sender (see template section below).

---

## 1. How to Send Weekly Emails

You need two things: **a scheduled trigger** (runs every week) and **a function that builds the summary and sends the email**.

### Option A: Supabase (recommended if you use Supabase)

1. **pg_cron** (Supabase supports it in the SQL editor):
   - Enable the `pg_cron` extension.
   - Schedule a job that runs once per week (e.g. Sunday 9:00) and calls a Supabase Edge Function (via `net.http_post` or by having the Edge Function invoked by an external cron that hits its URL).

2. **Edge Function that sends the email**:
   - Create an Edge Function, e.g. `supabase/functions/send-weekly-digest/index.ts`.
   - In that function:
     - Use the Supabase client with the **service role key** (so you can read all users’ settings).
     - Query users who have `enable_emails = true` (join `auth.users` with your `settings` table keyed by `user_id`).
     - For each user, fetch the data you need (budgets, net worth, alerts) from your DB.
     - Build the email body from the template below (or a variant).
     - Send the email using an HTTP call to an email API (Resend, SendGrid, Postmark, etc.). Store the API key in Supabase secrets and read it with `Deno.env.get('RESEND_API_KEY')` (or similar).

3. **Invoking the Edge Function weekly**:
   - **Option 1**: Use Supabase’s “Cron” (if available in your plan) to trigger the function URL on a schedule.
   - **Option 2**: Use an external cron (e.g. cron-job.org, GitHub Actions, or a small server) that does a `POST` to your Edge Function URL once per week. The Edge Function should be protected (e.g. require a secret header or Supabase service role) so only your cron can call it.

### Option B: Netlify (or another host)

- Add a **scheduled function** (e.g. Netlify’s “Scheduled Functions” or a similar cron) that runs weekly.
- That function does the same as above: fetch users with `enable_emails = true`, compute summary data, render the template, and call your email provider’s API.

In both cases, the **sending** is: “run a server/Edge function once per week → for each opted-in user, call the email API with the rendered template.”

---

## 2. Suggested Email Template

You can use one HTML template and optionally a plain-text fallback. The template assumes you pass a **payload** object from your sender.

### Data shape (payload to the template)

```ts
interface WeeklyDigestPayload {
  userName: string;
  periodEnd: string;           // e.g. "14 Mar 2025"
  budgetSummary: {
    totalBudget: number;
    totalSpent: number;
    percentUsed: number;
    overCategories: string[];  // category names over limit
  };
  netWorth: number;
  alerts: string[];            // short lines, e.g. "Entertainment 15% over budget"
}
```

### HTML template

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your weekly Finova summary</title>
</head>
<body style="margin:0; font-family: system-ui, -apple-system, sans-serif; background:#f8fafc; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden;">
    <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #fff; padding: 24px 24px 28px;">
      <h1 style="margin:0; font-size: 22px; font-weight: 700;">Weekly summary</h1>
      <p style="margin: 8px 0 0; opacity: 0.95; font-size: 14px;">{{periodEnd}}</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 20px; color: #334155; font-size: 15px;">Hi {{userName}},</p>
      <p style="margin: 0 0 20px; color: #64748b; font-size: 14px; line-height: 1.5;">Here’s your financial snapshot for the past week.</p>

      <section style="margin-bottom: 24px;">
        <h2 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">Budgets</h2>
        <div style="background: #f1f5f9; border-radius: 8px; padding: 16px;">
          <p style="margin: 0 0 4px; font-size: 13px; color: #64748b;">Spent vs budget</p>
          <p style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">{{budgetSummary.totalSpent}} / {{budgetSummary.totalBudget}}</p>
          <p style="margin: 8px 0 0; font-size: 13px; color: {{budgetSummary.percentUsed > 100 ? '#b91c1c' : '#15803d'}};">{{budgetSummary.percentUsed}}% of budget used</p>
        </div>
        {{#if budgetSummary.overCategories.length}}
        <p style="margin: 12px 0 0; font-size: 13px; color: #b91c1c;">Over budget: {{budgetSummary.overCategories.join(', ')}}</p>
        {{/if}}
      </section>

      <section style="margin-bottom: 24px;">
        <h2 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">Net worth</h2>
        <p style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">{{netWorth}}</p>
      </section>

      {{#if alerts.length}}
      <section style="margin-bottom: 24px;">
        <h2 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">Alerts</h2>
        <ul style="margin: 0; padding-left: 20px; color: #64748b; font-size: 14px; line-height: 1.6;">
          {{#each alerts}}
          <li>{{this}}</li>
          {{/each}}
        </ul>
      </section>
      {{/if}}

      <p style="margin: 24px 0 0; font-size: 13px; color: #94a3b8;">You’re receiving this because Weekly Email Reports are enabled in Settings. Open the app to see full details.</p>
    </div>
  </div>
</body>
</html>
```

**Canonical file:** `docs/weekly_email_template.html` (use as the email body). Placeholders: `{{userName}}`, `{{periodEnd}}`, `{{budgetSpent}}`, `{{budgetTotal}}`, `{{percentUsed}}`, `{{percentUsedColor}}`, `{{overCategoriesHtml}}`, `{{netWorth}}`, `{{alertsHtml}}`. Replace in code with simple string replace; for optional blocks (`overCategoriesHtml`, `alertsHtml`) inject pre-rendered HTML or empty string. See the HTML file for the exact structure.

### Plain-text fallback (optional)

```
Weekly summary – {{periodEnd}}

Hi {{userName}},

Budgets: {{budgetSummary.totalSpent}} / {{budgetSummary.totalBudget}} ({{budgetSummary.percentUsed}}% used).
{{#if budgetSummary.overCategories.length}}Over budget: {{budgetSummary.overCategories.join(', ')}}{{/if}}

Net worth: {{netWorth}}

{{#if alerts.length}}
Alerts:
{{#each alerts}}
- {{this}}
{{/each}}
{{/if}}

You’re receiving this because Weekly Email Reports are enabled in Settings.
```

---

## 3. Summary

| Question | Answer |
|----------|--------|
| **How will the email be sent weekly?** | Right now it isn’t. Add a **scheduled job** (Supabase cron + Edge Function, or Netlify/external cron) that runs weekly and, for each user with `enable_emails = true`, builds a digest and calls an **email API** (Resend, SendGrid, etc.). |
| **How will the template look?** | Use the **HTML and optional plain-text templates** above. Replace placeholders with the weekly digest payload (user name, period, budget summary, net worth, alerts). |

After you implement the sender and wire it to the schedule, weekly emails will go to users who have **Weekly Email Reports** turned on in Settings.
