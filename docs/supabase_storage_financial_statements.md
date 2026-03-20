# Financial statement file storage (Supabase)

After `supabase/migrations/add_financial_statements_storage.sql`, create a **private** bucket and RLS policies.

## Bucket

**Dashboard → Storage:** bucket id `financial-statements`, not public.

Or SQL:

```sql
insert into storage.buckets (id, name, public)
values ('financial-statements', 'financial-statements', false)
on conflict (id) do nothing;
```

## Policies

Object path: `{user_id}/{statement_id}/{filename}` — first folder must equal `auth.uid()`.

```sql
create policy "financial_statements_read_own"
on storage.objects for select to authenticated
using (bucket_id = 'financial-statements' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "financial_statements_insert_own"
on storage.objects for insert to authenticated
with check (bucket_id = 'financial-statements' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "financial_statements_delete_own"
on storage.objects for delete to authenticated
using (bucket_id = 'financial-statements' and (storage.foldername(name))[1] = auth.uid()::text);
```

Drop/rename if policies already exist.

## App

Upload runs after DB insert; if Storage is missing, imports still work. **Statement History** shows **Download original** when `storage_path` is set.
