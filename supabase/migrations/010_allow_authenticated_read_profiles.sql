-- Allow all authenticated users to read profiles (needed for teacher/student name joins)
create policy "Authenticated users read profiles"
  on profiles for select
  using (auth.role() = 'authenticated');
