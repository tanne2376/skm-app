-- ============================================================
-- DEFAULT CLASS TEMPLATES
-- day_of_week: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
-- price in pence: 1500 = £15.00
-- ============================================================

insert into class_templates (name, day_of_week, start_time, end_time, capacity, price) values
  ('Muay Thai (Beginners)',     1, '18:30', '19:30', 20, 1500),
  ('Muay Thai (Fighters)',      1, '19:30', '21:00', 15, 1500),
  ('Muay Thai (Fighters)',      3, '18:30', '20:00', 15, 1500),
  ('Strength and Conditioning', 3, '20:15', '20:45', 20, 1500),
  ('K1 (Intermediate)',         4, '19:30', '21:00', 20, 1500),
  ('K1 (Fighters)',             5, '18:30', '20:00', 15, 1500),
  ('Strength and Conditioning', 5, '20:15', '20:45', 20, 1500),
  ('Boxing',                    6, '10:00', '11:00', 20, 1500),
  ('Sparring',                  6, '11:00', '12:30', 15, 1500),
  ('Clinching',                 6, '12:30', '13:30', 15, 1500);

-- ============================================================
-- DEFAULT LOCATIONS
-- Update addresses before going live
-- ============================================================

insert into locations (name, address) values
  ('SKM Main Gym', '123 Example Street, London, E1 1AB'),
  ('SKM Ring Room', '123 Example Street, London, E1 1AB - Ring Room'),
  ('Online', 'Online session - link provided separately');
