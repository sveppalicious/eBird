// i18n.js -- the interface in Icelandic and in English.
//
// One switch changes the whole interface, not only the species names. Most of
// the eBirders in this data are visitors, and most of the people who will care
// about a list for their sveitarfelag are not, so neither language is the
// afterthought.
//
// Icelandic declines place names, and a template cannot: "í {name}" would need
// the dative of whatever is dropped into it. Strings are therefore written so a
// name only ever stands in the nominative -- after a colon, or in apposition
// ("á svæðinu {region}") -- rather than after a preposition.

const LANG_KEY = 'lang';

const STRINGS = {
  is: {
    'brand.sub': 'Ísland · sveitarfélög',
    'loading': 'Hleð…',
    'you': 'þú',
    'error.title': 'Eitthvað fór úrskeiðis',
    'notfound.page': 'Síðan fannst ekki',
    'notfound.region': 'Svæðið fannst ekki',
    'nav.home': 'Ísland',
    'nav.myfile': 'Skráin mín',
    'source.label': 'Hvaða gögn',
    'source.all': 'Allir',
    'source.mine': 'Mín gögn',
    'lang.label': 'Tungumál',
    'search.placeholder': 'Leita að tegund eða stað…',
    'search.none': 'Ekkert fannst',
    'search.species': 'Tegund',

    'kind.country': 'Land',
    'kind.sveitarfelag': 'Sveitarfélag',
    'kind.hverfi': 'Hverfi',
    'kind.postnumer': 'Póstnúmer',
    'kind.sea': 'Hafsvæði',

    'tab.species': 'Tegundir',
    'tab.areas': 'Svæði',
    'tab.checklists': 'Gátlistar',
    'tab.activity': 'Virkni',
    'tab.firsts': 'Nýtt',

    'stat.species': 'Tegundir',
    'stat.speciesMine': 'Mínar tegundir',
    'stat.taxa': '{n} með óákveðnum og blendingum',
    'stat.checklists': 'Gátlistar',
    'stat.complete': 'Heilir gátlistar',
    'stat.completeOf': 'þar af {n} heilir',
    'stat.observers': 'Athugendur',
    'stat.localities': 'Staðir',
    'stat.latest': 'Nýjasta skráning',
    'stat.since': 'frá {d}',
    'stat.frequency': 'Tíðni',
    'stat.frequencySub': 'af heilum gátlistum',

    'col.species': 'Tegund',
    'col.freq': 'Tíðni',
    'col.checklists': 'Gátlistar',
    'col.first': 'Fyrst',
    'col.last': 'Síðast',
    'col.location': 'Staður',
    'col.observer': 'Athugandi',
    'col.high': 'Mest',
    'col.region': 'Svæði',
    'col.date': 'Dagsetning',
    'col.protocol': 'Aðferð',
    'col.duration': 'Lengd',
    'col.distance': 'Vegalengd',
    'col.count': 'Fjöldi',
    'col.newfor': 'Nýtt á svæði',
    'col.withSpecies': 'Gátlistar með tegund',

    'filter.find': 'Leita',
    'filter.year': 'Ár',
    'filter.allyears': 'Öll ár',
    'find.none': 'Ekkert passar við leitina.',
    'sort.label': 'Röðun',
    'sort.taxon': 'Flokkunarröð',
    'sort.freq': 'Algengast',
    'sort.last': 'Síðast séð',
    'sort.first': 'Nýjast á lista',
    'pager.prev': '‹ Fyrri',
    'pager.next': 'Næsta ›',
    'pager.of': '{a}–{b} af {n}',

    'species.find': 'Íslenskt, enskt eða fræðiheiti…',
    'species.none': 'Engar tegundir skráðar hér.',
    'species.freqNote': 'Tíðni er hlutfall heilla gátlista sem skráðu tegundina.',
    'species.backTo': 'Svæði: {name}',
    'species.noneHere': 'Engar skráningar á tegundinni {name} á svæðinu {region}.',
    'species.noneMine': 'Þú átt engar skráningar á tegundinni {name} á svæðinu {region}.',
    'species.seeIn': 'Skoða tegundina {name} á svæðinu {region}',
    'species.when': 'Hvenær',
    'species.where': 'Hvar — {region}',
    'species.records': 'Skráningar',

    'records.none': 'Engar skráningar.',
    'records.truncated': 'Nýjustu {n} af {total} skráningum. Veldu sveitarfélag til að sjá allar.',

    'checklists.find': 'staður eða athugandi…',
    'checklists.count': '{n} gátlistar',
    'checklists.truncated': 'Nýjustu {n} af {total} gátlistum. Veldu sveitarfélag til að fletta þeim öllum.',
    'checklists.incomplete': 'hluti',
    'checklists.incompleteTitle': 'Ekki voru allar tegundir skráðar, svo listinn telst ekki með í tíðni',

    'region.straddle': 'Póstnúmerið {name} nær yfir fleiri en eitt sveitarfélag. Þessi síða sýnir aðeins hlutann í sveitarfélaginu {here}. Aðrir hlutar:',
    'region.sea': 'Gátlistar meira en 30 km frá næsta sveitarfélagi: úthafssiglingar, ferjur og sjófuglaferðir. Þeir tilheyra engu sveitarfélagi og er því safnað hér.',
    'region.offshore': '{n} af {total} gátlistum hér eru frá stöðum úti á sjó (bátsferðir, fuglaeyjar, ferjur) sem teljast til næsta sveitarfélags.',

    'ebd.lead': 'Byggt á eBird Basic Dataset (EBD), ekki lifandi eBird.',
    'ebd.body': 'EBD kemur út mánaðarlega, þann 15., og nær til loka mánaðarins á undan. Þessi útgáfa ({release}) nær til og með',
    'ebd.tail': 'Nýrri skráningar, og þær sem bíða yfirferðar, birtast ekki enn.',

    'map.reset': 'Upphafleg sýn',
    'map.points': 'Mínir staðir ({n})',
    'map.pointTip': '{k} gátlistar · {s} tegundir',
    'map.species': '{n} tegundir',
    'map.speciesMine': '{n} tegundir á þínum lista',
    'map.none': 'engar skráningar',
    'map.legend': 'tegundir',
    'map.legendMine': 'tegundir á þínum lista',
    'map.legendChecklists': 'gátlistar með tegundinni',
    'map.checklists': '{n} gátlistar',
    'map.notRecorded': 'ekki skráð',

    'chart.byYear': 'Eftir árum',
    'chart.byMonth': 'Eftir mánuðum',
    'chart.month': 'Mánuður',
    'chart.heat': 'Ár og mánuðir',
    'chart.heatNote': 'Tómir reitir: enginn heill gátlisti þann mánuð.',
    'chart.arrivals': 'Fyrsta skráning hvers árs',
    'chart.arrivalsNote': 'Koma farfugls — en fleiri athugendur finna fugla fyrr, svo eldri ár eru ekki fyllilega sambærileg.',
    'chart.median': 'miðgildi {d}',
    'chart.freqNote': 'Súlurnar sýna tíðni: hlutfall heilla gátlista sem skráðu tegundina. Þannig sést breyting á fuglunum en ekki á fjölda athugenda.',
    'chart.ofComplete': 'á {c} af {ec} heilum gátlistum',
    'chart.onChecklists': 'á {n} gátlistum',
    'chart.pale': 'Ljóst: færri en {n} heilir gátlistar — of fáir til að treysta',
    'chart.thinYear': 'fáir gátlistar þetta ár',
    'chart.noEffort': 'engir heilir gátlistar',
    'chart.table': 'Sýna sem töflu',
    'chart.none': 'Ekki næg gögn í línurit.',

    'activity.species': 'Tegundir á ári',
    'activity.speciesNote': 'Fjöldi tegunda sem skráðar voru hvert ár.',
    'activity.checklists': 'Gátlistar á ári',
    'activity.checklistsNote': 'Hversu mikið var skoðað — það sem tíðni er reiknuð út frá.',
    'activity.none': 'Engir gátlistar.',

    'firsts.all': 'Allt',
    'firsts.lifer': 'Fyrst á Íslandi',
    'firsts.liferTitle': 'Í fyrsta sinn sem þú skráðir tegundina á Íslandi',
    'firsts.areas': 'Hverfi og póstnúmer',
    'firsts.lede': 'Í hvert sinn sem tegund var ný á svæði: {n} skipti. Tegund telst aftur fyrir hvert sveitarfélag, hverfi og póstnúmer.',
    'firsts.none': 'Ekkert nýtt hér.',
    'firsts.since': 'Frá fyrri skrá ({d}):',
    'firsts.newIceland': '{n} nýjar á Íslandslistann',
    'firsts.newTicks': '{n} nýjar á svæðislista',
    'firsts.seeAll': 'Sjá allt nýtt',

    'me.title': 'Mín gögn',
    'me.lede': 'Hladdu upp eBird-skránni þinni og skoðaðu þínar eigin skráningar eftir sveitarfélögum, hverfum og póstnúmerum.',
    'me.ofIceland': 'af {n} á Íslandi',
    'me.municipalities': 'Sveitarfélög',
    'me.ofTotal': 'af {n} heimsótt',
    'me.explore': 'Skoða mín gögn',
    'me.replace': 'Skipta um skrá',
    'me.remove': 'Fjarlægja gögnin mín',
    'me.imported': 'lesið inn {d}',
    'me.notInDataset': 'Tegundir á þínum lista sem eru ekki enn í þessari útgáfu EBD — nýjar eða í yfirferð ({n}):',
    'me.unplaced': 'Skráningar á stöðum sem ekki tókst að staðsetja ({n}):',
    'me.unknownTaxa': 'Fræðiheiti sem þekktust ekki ({n}):',

    'import.choose': 'Veldu MyEBirdData.csv',
    'import.drag': 'eða dragðu skrána hingað',
    'import.reading': 'Les {name}…',
    'import.sessionOnly': 'Lesið inn, en ekki tókst að vista í vafranum — gögnin eru hér þar til þú lokar síðunni.',
    'import.err.empty': 'Skráin er tóm.',
    'import.err.column': 'Þetta virðist ekki vera eBird-skrá — dálkinn „{column}“ vantar. Notaðu CSV-skrána frá ebird.org → My eBird → Download my data.',
    'import.err.no-iceland': 'Engar skráningar frá Íslandi í skránni.',
    'import.howTitle': 'Að sækja skrána',
    'import.how1': 'Skráðu þig inn á',
    'import.how2': 'Biddu um gögnin þín; eBird sendir þér zip-skrá í tölvupósti.',
    'import.how3': 'Afþjappaðu hana og veldu',
    'import.howNote': 'Skráin nær yfir allan lífslistann þinn. Aðeins línur frá Íslandi (IS-1 … IS-8) eru lesnar.',

    'privacy.lead': 'Skráin fer aldrei úr vafranum þínum.',
    'privacy.body': 'Hún er lesin og unnin hér á síðunni. Henni er ekki hlaðið upp neitt — vefurinn er aðeins kyrrstæðar skrár og hefur engan þjón til að taka við henni. Gögnin eru geymd í þessum vafra á þessu tæki og „Fjarlægja gögnin mín“ eyðir þeim.',
    'privacy.care': 'eBird-skrá segir hvar þú hefur verið og hvenær. Farðu með hana samkvæmt því.',

    'foot.cutoff': 'Skráningar til og með {d}. EBD kemur út mánaðarlega, þann 15., svo nýjustu skráningar vantar.',
    'foot.boundaries': 'Mörk sveitarfélaga: {v}, Landmælingar Íslands (CC BY 4.0). Hverfi: Hagstofa Íslands. Póstnúmer: Byggðastofnun. Unnið {built}.',
    'foot.observers': 'Nöfn athugenda fylgja ekki EBD, svo þeir birtast með eBird-auðkenni sínu, sem vísar á prófílinn þeirra.'
  },

  en: {
    'brand.sub': 'Iceland · municipalities',
    'loading': 'Loading…',
    'you': 'you',
    'error.title': 'Something went wrong',
    'notfound.page': 'Page not found',
    'notfound.region': 'No such region',
    'nav.home': 'Iceland',
    'nav.myfile': 'My file',
    'source.label': 'Whose data',
    'source.all': 'Everyone',
    'source.mine': 'My data',
    'lang.label': 'Language',
    'search.placeholder': 'Find a species or a place…',
    'search.none': 'Nothing found',
    'search.species': 'Species',

    'kind.country': 'Country',
    'kind.sveitarfelag': 'Municipality',
    'kind.hverfi': 'Neighbourhood',
    'kind.postnumer': 'Postal area',
    'kind.sea': 'Open sea',

    'tab.species': 'Species',
    'tab.areas': 'Areas',
    'tab.checklists': 'Checklists',
    'tab.activity': 'Activity',
    'tab.firsts': 'Firsts',

    'stat.species': 'Species',
    'stat.speciesMine': 'My species',
    'stat.taxa': '{n} taxa incl. spuh and hybrids',
    'stat.checklists': 'Checklists',
    'stat.complete': 'Complete checklists',
    'stat.completeOf': '{n} of them complete',
    'stat.observers': 'eBirders',
    'stat.localities': 'Localities',
    'stat.latest': 'Latest record',
    'stat.since': 'since {d}',
    'stat.frequency': 'Frequency',
    'stat.frequencySub': 'of complete checklists',

    'col.species': 'Species',
    'col.freq': 'Frequency',
    'col.checklists': 'Checklists',
    'col.first': 'First',
    'col.last': 'Last',
    'col.location': 'Location',
    'col.observer': 'Observer',
    'col.high': 'High count',
    'col.region': 'Region',
    'col.date': 'Date',
    'col.protocol': 'Protocol',
    'col.duration': 'Duration',
    'col.distance': 'Distance',
    'col.count': 'Count',
    'col.newfor': 'New for',
    'col.withSpecies': 'Checklists with it',

    'filter.find': 'Find',
    'filter.year': 'Year',
    'filter.allyears': 'All years',
    'find.none': 'Nothing matches.',
    'sort.label': 'Sort',
    'sort.taxon': 'Taxonomic',
    'sort.freq': 'Most frequent',
    'sort.last': 'Last seen',
    'sort.first': 'Newest on list',
    'pager.prev': '‹ Previous',
    'pager.next': 'Next ›',
    'pager.of': '{a}–{b} of {n}',

    'species.find': 'Icelandic, English or scientific name…',
    'species.none': 'No species recorded here.',
    'species.freqNote': 'Frequency is the share of complete checklists that reported the species.',
    'species.backTo': 'Region: {name}',
    'species.noneHere': 'No records of {name} in {region}.',
    'species.noneMine': 'You have no records of {name} in {region}.',
    'species.seeIn': 'See {name} in {region}',
    'species.when': 'When',
    'species.where': 'Where in {region}',
    'species.records': 'Records',

    'records.none': 'No records.',
    'records.truncated': 'The latest {n} of {total} records. Pick a municipality to see them all.',

    'checklists.find': 'location or observer…',
    'checklists.count': '{n} checklists',
    'checklists.truncated': 'The latest {n} of {total} checklists. Pick a municipality to browse them all.',
    'checklists.incomplete': 'partial',
    'checklists.incompleteTitle': 'Not every species was reported, so it does not count towards frequency',

    'region.straddle': 'Postal district {name} crosses a municipality boundary. This page covers only the part in {here}. The rest is under:',
    'region.sea': 'Checklists more than 30 km from the nearest municipality: ocean crossings, ferries and seabird trips. They belong to no municipality, so they are collected here rather than dropped.',
    'region.offshore': '{n} of {total} checklists here are at offshore localities (boat trips, bird islands, ferries), assigned to the nearest municipality.',

    'ebd.lead': 'Built from the eBird Basic Dataset (EBD), not live eBird.',
    'ebd.body': 'The EBD is published monthly, on the 15th, and runs to the end of the month before. This build ({release}) covers records through',
    'ebd.tail': 'Anything newer, or still awaiting review, is not here yet.',

    'map.reset': 'Reset view',
    'map.points': 'My localities ({n})',
    'map.pointTip': '{k} checklists · {s} species',
    'map.species': '{n} species',
    'map.speciesMine': '{n} species on your list',
    'map.none': 'no records',
    'map.legend': 'species',
    'map.legendMine': 'species on your list',
    'map.legendChecklists': 'checklists with the species',
    'map.checklists': '{n} checklists',
    'map.notRecorded': 'not recorded',

    'chart.byYear': 'By year',
    'chart.byMonth': 'By month',
    'chart.month': 'Month',
    'chart.heat': 'Year by month',
    'chart.heatNote': 'Empty cells: no complete checklist that month.',
    'chart.arrivals': 'First record of each year',
    'chart.arrivalsNote': 'A migrant’s arrival — though more observers find birds sooner, so earlier years are not strictly comparable.',
    'chart.median': 'median {d}',
    'chart.freqNote': 'Bars show frequency: the share of complete checklists that reported the species. That shows a change in the birds rather than in the number of birders.',
    'chart.ofComplete': 'on {c} of {ec} complete checklists',
    'chart.onChecklists': 'on {n} checklists',
    'chart.pale': 'Pale: fewer than {n} complete checklists — too few to trust',
    'chart.thinYear': 'few checklists that year',
    'chart.noEffort': 'no complete checklists',
    'chart.table': 'Show as a table',
    'chart.none': 'Not enough data to chart.',

    'activity.species': 'Species per year',
    'activity.speciesNote': 'How many species were recorded each year.',
    'activity.checklists': 'Checklists per year',
    'activity.checklistsNote': 'How much birding was done — what frequency is measured against.',
    'activity.none': 'No checklists.',

    'firsts.all': 'All',
    'firsts.lifer': 'First in Iceland',
    'firsts.liferTitle': 'The first time you recorded this species anywhere in Iceland',
    'firsts.areas': 'Neighbourhoods & postal areas',
    'firsts.lede': 'Every time a species was new somewhere: {n} firsts. A species counts again for each municipality, neighbourhood and postal area.',
    'firsts.none': 'No firsts here.',
    'firsts.since': 'Since your previous file ({d}):',
    'firsts.newIceland': '{n} new for your Iceland list',
    'firsts.newTicks': '{n} new regional ticks',
    'firsts.seeAll': 'See all firsts',

    'me.title': 'My data',
    'me.lede': 'Upload your eBird export to explore your own records by municipality, neighbourhood and postal area.',
    'me.ofIceland': 'of {n} in Iceland',
    'me.municipalities': 'Municipalities',
    'me.ofTotal': 'of {n} visited',
    'me.explore': 'Explore my data',
    'me.replace': 'Replace file',
    'me.remove': 'Remove my data',
    'me.imported': 'imported {d}',
    'me.notInDataset': 'Species on your list that are not in this EBD release yet — new, or under review ({n}):',
    'me.unplaced': 'Records at localities that could not be placed ({n}):',
    'me.unknownTaxa': 'Scientific names that were not recognised ({n}):',

    'import.choose': 'Choose your MyEBirdData.csv',
    'import.drag': 'or drag it here',
    'import.reading': 'Reading {name}…',
    'import.sessionOnly': 'Loaded, but it could not be saved in this browser — it will be here until you close the page.',
    'import.err.empty': 'That file is empty.',
    'import.err.column': 'This does not look like an eBird export — the column “{column}” is missing. Use the CSV from ebird.org → My eBird → Download my data.',
    'import.err.no-iceland': 'No Icelandic records in that file.',
    'import.howTitle': 'Getting the file',
    'import.how1': 'Sign in at',
    'import.how2': 'Request your data; eBird emails you a zip.',
    'import.how3': 'Unzip it and pick',
    'import.howNote': 'The export covers your whole life list. Only rows in Iceland (IS-1 … IS-8) are read.',

    'privacy.lead': 'Your file stays in this browser.',
    'privacy.body': 'It is read and analysed here on the page. It is not uploaded — this site is static files with no server to receive it. It is kept in this browser on this device only, and “Remove my data” erases it.',
    'privacy.care': 'An eBird export is a record of where you have been and when. Treat it accordingly.',

    'foot.cutoff': 'Records through {d}. The EBD is released monthly, on the 15th, so recent sightings are not here yet.',
    'foot.boundaries': 'Municipality boundaries: {v}, Landmælingar Íslands (CC BY 4.0). Neighbourhoods: Statistics Iceland. Postal areas: Byggðastofnun. Built {built}.',
    'foot.observers': 'Observer names are not distributed in the EBD, so eBirders appear as their eBird id, which links to their profile.'
  }
};

// A translator for one language. A key missing from it falls back to English
// and then to the key itself, so a gap shows up as odd text, not as a crash.
function makeT(lang) {
  const table = STRINGS[lang] || STRINGS.en;
  return (key, vars) => {
    let s = table[key];
    if (s === undefined) s = STRINGS.en[key];
    if (s === undefined) return key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k]))) : s;
  };
}

function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'is' || saved === 'en') return saved;
  } catch { /* storage disabled */ }
  // No choice made yet: Icelandic for an Icelandic browser, English otherwise.
  return typeof navigator !== 'undefined' && /^is\b/i.test(navigator.language || '') ? 'is' : 'en';
}

function saveLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage disabled */ }
}

export { STRINGS, makeT, initialLang, saveLang };
