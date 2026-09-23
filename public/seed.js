/* Starter data: the preliminary item list from the nudes ordering sheet.
   Par levels default to one case each — set real pars on the items screen. */

export const SEED_SETTINGS = {
  storeName: 'nudes',
  address: '165 s crescent heights blvd',
  city: 'los angeles',
  signoff: 'thanks!\nnudes',
  managerEmails: [],
  areas: ['walk-in fridge', 'freezer', 'dry storage', 'front counter'],
};

export const SEED_SUPPLIERS = [
  { id: 'pregel', name: 'pregel', contact: '', method: 'email', to: '', deliveryDays: [], cutoffTime: '', cutoffOffset: 1, notes: '' },
  { id: 'aussi', name: 'aussi blend', contact: '', method: 'email', to: '', deliveryDays: [], cutoffTime: '', cutoffOffset: 1, notes: '' },
];

// tags: halal, gluten-free, dairy-free, vegan, ou-kosher-pareve, ou-kosher-dairy, kosher-pareve, kosher-chalavi
export const SEED_ITEMS = [
  { name: 'green tea', code: '91901', category: 'sprints - flavored bases', supplierId: 'pregel', area: 'dry storage', unit: 'bag', unitsPerCase: 12, casePrice: 274.15, weightOz: null, par: 12, tags: ['gluten-free'] },
  { name: 'white base', code: '305162', category: 'sprints - flavored bases', supplierId: 'pregel', area: 'dry storage', unit: 'bag', unitsPerCase: 12, casePrice: 189.90, weightOz: null, par: 12, tags: ['gluten-free', 'ou-kosher-dairy'] },
  { name: 'always fresco fruit', code: '302142', category: 'always fresco bases', supplierId: 'pregel', area: 'dry storage', unit: 'bag', unitsPerCase: 12, casePrice: 189.50, weightOz: null, par: 12, tags: ['gluten-free', 'dairy-free', 'vegan'] },
  { name: 'passion fruit', code: '84006', category: 'arabeschi variegates', supplierId: 'pregel', area: 'dry storage', unit: 'bottle', unitsPerCase: 6, casePrice: 154.20, weightOz: null, par: 6, tags: ['halal', 'gluten-free', 'dairy-free', 'vegan', 'ou-kosher-pareve', 'kosher-pareve'] },
  { name: 'greek yogurt', code: '305318', category: 'sprints - flavored bases', supplierId: 'pregel', area: 'dry storage', unit: 'bag', unitsPerCase: 8, casePrice: 234.90, weightOz: null, par: 8, tags: ['gluten-free', 'ou-kosher-dairy'] },
  { name: 'coconut sprint', code: '', category: 'blends coconut vegan ice cream mix, plant-based', supplierId: 'aussi', area: 'dry storage', unit: 'bag', unitsPerCase: 8, casePrice: 127, weightOz: null, par: 8, tags: ['halal', 'gluten-free', 'dairy-free', 'vegan', 'kosher-pareve'] },
  { name: 'vegan soft serve mix', code: '', category: 'vegan soft serve mixes', supplierId: 'aussi', area: 'dry storage', unit: 'bag', unitsPerCase: 8, casePrice: 114, weightOz: null, par: 8, tags: ['halal', 'gluten-free', 'dairy-free', 'vegan', 'kosher-pareve'] },
  { name: 'concentrated dark chocolate', code: '', category: 'chocolate & coffee concentrated flavorings', supplierId: 'aussi', area: 'dry storage', unit: 'bottle', unitsPerCase: 1, casePrice: null, weightOz: null, par: 1, tags: ['halal', 'gluten-free', 'dairy-free', 'vegan', 'kosher-pareve'] },
];
