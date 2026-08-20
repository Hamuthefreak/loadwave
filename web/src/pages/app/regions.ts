export const PROVINCES = [
  { code: 'QC', name: 'Québec' },
  { code: 'ON', name: 'Ontario' },
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'NL', name: 'Newfoundland & Labrador' },
];

export const US_STATES = [
  { code: 'NY', name: 'New York' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'ME', name: 'Maine' },
  { code: 'IL', name: 'Illinois' },
  { code: 'MI', name: 'Michigan' },
  { code: 'OH', name: 'Ohio' },
  { code: 'IN', name: 'Indiana' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'TX', name: 'Texas' },
  { code: 'GA', name: 'Georgia' },
  { code: 'FL', name: 'Florida' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'VA', name: 'Virginia' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'CA', name: 'California' },
];

export const REGION_OPTIONS = [...PROVINCES, ...US_STATES];

export const EQUIPMENT_TYPES = [
  { value: 'DRY_VAN', label: 'Dry Van' },
  { value: 'REEFER', label: 'Reefer' },
  { value: 'FLATBED', label: 'Flatbed' },
  { value: 'POWER_ONLY', label: 'Power Only' },
  { value: 'LOWBOY', label: 'Low Boy' },
  { value: 'STEP_DECK', label: 'Step Deck' },
  { value: 'HOT_SHOT', label: 'Hot Shot' },
  { value: 'LIQUID', label: 'Liquid / Tanker' },
];

export function equipmentLabel(value: string | null | undefined): string {
  const found = EQUIPMENT_TYPES.find((e) => e.value === (value ?? '').toUpperCase());
  return found?.label ?? value ?? '—';
}