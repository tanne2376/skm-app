// Text of "The Scrapyard Combat Academy Ltd — Participation, Gym & Sauna
// Acknowledgment 2026". Keep in sync with the signed paper form.

export const WAIVER_TITLE = 'The Scrapyard Combat Academy Ltd';
export const WAIVER_SUBTITLE = 'Participation, Gym & Sauna Acknowledgment | 2026';

export const WAIVER_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: 'Activities & Risks',
    body:
      'I wish to use the facilities and/or take part in activities at The Scrapyard Combat Academy Ltd, including Muay Thai, K1, boxing, sparring, pad work, conditioning, strength training, free weights, resistance and cardio equipment, and the sauna. I understand that training may involve contact with others, falls, strikes, overexertion or equipment use. Risks include bruising, sprains, fractures, concussion and other head injury, serious injury and, rarely, death. Gym equipment carries risks including dropped weights, trapping, strains and equipment misuse. Sauna use carries risks including heat stress, dehydration, fainting, burns and slips. I understand these risks and choose to participate or use the facilities.',
  },
  {
    heading: 'Health & Emergency Care',
    body:
      'I will tell a coach or staff member about any injury, illness, pregnancy, relevant condition or medication that may affect safe participation or sauna use, and seek medical advice when unsure. I will stop immediately and alert staff if I feel unwell, dizzy, faint, unusually breathless or in pain. I understand staff may call emergency services and share relevant information with them if needed. I understand that any treatment is provided by medical professionals, not by the gym.',
  },
  {
    heading: 'Training & Equipment Rules',
    body:
      "I will follow posted rules and staff instructions, train within my ability, use required protective equipment, ask for an induction or help before using unfamiliar equipment, check that weights are secured, and leave equipment in a safe condition. Sparring or contact drills require a coach's permission and supervision. I will not train or use equipment while impaired by alcohol or drugs. I will report unsafe equipment, hazards and injuries promptly. Staff may stop my participation or facility use for safety reasons.",
  },
  {
    heading: 'Sauna Rules',
    body:
      "I will follow the displayed sauna rules and staff instructions, including occupancy and time limits. I will hydrate, avoid sauna use while intoxicated or unwell, and leave immediately if I feel dizzy, weak or uncomfortable. I will use a towel, avoid touching the heater or hot surfaces, and take care on wet floors. I will not pour liquids on the heater unless staff expressly permit it. I will seek medical advice before sauna use if pregnant or if I have a heart, blood pressure or other condition that may be affected by heat. Access by under-18s is subject to the gym's separate age and supervision rules.",
  },
  {
    heading: 'Responsibility & Legal Rights',
    body:
      "I accept the ordinary risks of activities I choose to undertake and am responsible for following the safety rules above. Nothing in this form excludes or limits the gym's liability for death or personal injury caused by negligence, or any other liability that cannot lawfully be excluded or limited. Signing does not affect my statutory rights.",
  },
];

export const WAIVER_PHOTO_CONSENT =
  'I agree to photos or videos of me being used by The Scrapyard Combat Academy Ltd for its website, social media and promotional materials. Declining does not affect access. I may withdraw consent for future use by contacting the gym; material already distributed may not be retractable.';

/** Photo consent wording when a parent signs on behalf of their child. */
export const WAIVER_PHOTO_CONSENT_CHILD = WAIVER_PHOTO_CONSENT.replace('photos or videos of me', 'photos or videos of my child');

export const WAIVER_GUARDIAN_STATEMENT =
  "I confirm I have parental responsibility and consent to the child's participation in permitted activities. I will tell staff about relevant health or safety needs. The child remains subject to the gym's age, supervision and sauna access rules. The legal rights statement above also applies to the child.";

export const WAIVER_FOOTER = 'Please read the separate gym and sauna rules before using the facilities.';
