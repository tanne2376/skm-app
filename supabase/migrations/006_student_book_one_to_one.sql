create policy "Students book available one_to_ones"
  on one_to_ones for update
  using (status = 'available')
  with check (student_id = auth.uid() and status = 'booked');
