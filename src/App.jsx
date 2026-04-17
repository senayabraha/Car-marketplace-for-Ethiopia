import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Search, Heart, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  MapPin, Car, Tag, Menu, X, SlidersHorizontal, ArrowUpDown,
  UserCircle2, Phone, MoreVertical, ArrowRight, Trash2,
  Camera, MessageCircle, Send, LogOut, Shield, Store, Flag, FileText,
} from "lucide-react";

import { supabase } from "./lib/supabase";
import {
  loadListings,
  createListing as apiCreateListing,
  deleteListing as apiDeleteListing,
  loadSavedIds,
  toggleSaved as apiToggleSaved,
  uploadPhoto,
  getCurrentUserId,
  getCurrentProfile,
  signInWithEmail,
  signUpWithEmail,
  signOut as apiSignOut,
  updateProfile as apiUpdateProfile,
  resetPassword,
} from "./lib/storage";

/* =========================================================================
   THREADS / MESSAGES / REPORTS — Supabase helpers (inline)
   ========================================================================= */

async function loadThreadsForUser(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("threads")
    .select("*, messages(*)")
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .order("updated_at", { ascending: false });
  if (error) { console.error("loadThreads:", error); return []; }
  return (data || []).map(t => ({
    id: t.id,
    listingId: t.listing_id,
    buyerId: t.buyer_id,
    sellerId: t.seller_id,
    buyerName: t.buyer_name || "Buyer",
    sellerName: t.seller_name || "Seller",
    updatedAt: new Date(t.updated_at).getTime(),
    messages: (t.messages || [])
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(m => ({
        id: m.id,
        from: m.sender_id,
        text: m.text,
        at: new Date(m.created_at).getTime(),
        readBy: m.read_by || [],
      })),
    unreadFor: computeUnread(t, userId),
  }));
}

function computeUnread(thread, userId) {
  const msgs = thread.messages || [];
  const unread = msgs.some(m => m.sender_id !== userId && !(m.read_by || []).includes(userId));
  return unread ? [userId] : [];
}

async function startThread(listing, currentUserId, currentProfile) {
  const existing = await supabase
    .from("threads")
    .select("*")
    .eq("listing_id", listing.id)
    .eq("buyer_id", currentUserId)
    .maybeSingle();
  if (existing.data) return existing.data.id;
  const { data, error } = await supabase
    .from("threads")
    .insert({
      listing_id: listing.id,
      buyer_id: currentUserId,
      seller_id: listing.sellerId,
      buyer_name: currentProfile?.name || "Buyer",
      seller_name: listing.sellerName || "Seller",
    })
    .select()
    .single();
  if (error) throw error;
  return data.id;
}

async function sendMessageToThread(threadId, senderId, text) {
  const { error } = await supabase.from("messages").insert({
    thread_id: threadId, sender_id: senderId, text, read_by: [senderId],
  });
  if (error) throw error;
  await supabase.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
}

async function markThreadRead(threadId, userId) {
  const { data: msgs } = await supabase.from("messages").select("id, read_by, sender_id").eq("thread_id", threadId);
  if (!msgs) return;
  for (const m of msgs) {
    if (m.sender_id === userId) continue;
    const rb = m.read_by || [];
    if (!rb.includes(userId)) {
      await supabase.from("messages").update({ read_by: [...rb, userId] }).eq("id", m.id);
    }
  }
}

async function submitReport(listingId, reporterId, reason) {
  const { error } = await supabase.from("reports").insert({
    listing_id: listingId, reporter_id: reporterId, reason, status: "pending",
  });
  if (error) throw error;
}

/* =========================================================================
   STATIC DATA — makes, models, body styles
   ========================================================================= */

const MODELS_BY_MAKE = {
  // ===== TIER 1: Full data (models + trims) =====
  "BMW": ["1-Series","2-Series","3-Series","4-Series","5-Series","6-Series","7-Series","8-Series","i3","i4","i7","iX","iX3","M2","M3","M4","M5","M8","X1","X2","X3","X4","X5","X6","X7","Z4"],
  "Ford": ["Bronco","EcoSport","Edge","Escape","Everest","Expedition","Explorer","F-150","F-250","Fiesta","Focus","Fusion","Mustang","Ranger","Taurus","Territory","Transit"],
  "Toyota": ["86","4Runner","Avalon","Avanza","Belta","C-HR","Camry","Corolla","Corolla Cross","FJ Cruiser","Fortuner","Harrier","Highlander","Hilux","Land Cruiser","Land Cruiser 70","Land Cruiser Prado","Mark X","Passo","Prius","Probox","RAV-4","Rush","Sequoia","Sienna","Supra","Tacoma","Tundra","Vitz","Wish","Yaris","Yaris Cross"],

  // ===== TIER 2: Modern makes with curated models =====
  "Acura": ["ILX","Integra","MDX","NSX","RDX","TLX","ZDX"],
  "Alfa Romeo": ["4C","Giulia","Giulietta","MiTo","Stelvio","Tonale"],
  "Aston Martin": ["DB11","DB12","DBS","DBX","Valhalla","Vanquish","Vantage"],
  "Audi": ["A1","A3","A4","A5","A6","A7","A8","e-tron","e-tron GT","Q2","Q3","Q4","Q5","Q7","Q8","R8","RS3","RS5","RS6","RS7","S3","S5","TT"],
  "Bentley": ["Bentayga","Continental GT","Flying Spur"],
  "Buick": ["Enclave","Encore","Encore GX","Envision","LaCrosse","Regal"],
  "Cadillac": ["CT4","CT5","Escalade","Lyriq","XT4","XT5","XT6"],
  "Chevrolet": ["Aveo","Blazer","Camaro","Colorado","Corvette","Cruze","Equinox","Malibu","Optra","Silverado 1500","Spark","Suburban","Tahoe","Tracker","TrailBlazer","Traverse"],
  "Chrysler": ["200","300","Pacifica","Voyager"],
  "Dodge": ["Challenger","Charger","Durango","Grand Caravan","Hornet","Journey","Nitro"],
  "Ferrari": ["296 GTB","488","812","F8","Portofino","Purosangue","Roma","SF90"],
  "Fiat": ["500","500L","500X","Doblo","Ducato","Fiorino","Linea","Panda","Punto","Tipo"],
  "GMC": ["Acadia","Canyon","Hummer EV","Savana","Sierra","Terrain","Yukon"],
  "Genesis": ["G70","G80","G90","GV60","GV70","GV80","GV80 Coupe"],
  "Honda": ["Accord","BR-V","City","Civic","CR-V","Fit","HR-V","Insight","Jazz","Odyssey","Passport","Pilot","Ridgeline","Vezel","WR-V"],
  "Hyundai": ["Accent","Atos","Creta","Elantra","Grand i10","H-1","H-100","i10","i20","i30","Ioniq 5","Ioniq 6","Kona","Palisade","Santa Cruz","Santa Fe","Sonata","Staria","Tucson","Venue","Verna"],
  "Infiniti": ["Q50","Q60","QX50","QX55","QX60","QX80"],
  "Jaguar": ["E-Pace","F-Pace","F-Type","I-Pace","XE","XF","XJ"],
  "Jeep": ["Cherokee","Commander","Compass","Gladiator","Grand Cherokee","Grand Cherokee L","Renegade","Wagoneer","Wrangler"],
  "Kia": ["Carnival","Ceed","EV6","EV9","Forte","K5","Niro","Picanto","Rio","Seltos","Sonet","Sorento","Soul","Sportage","Stinger","Stonic","Telluride"],
  "Lamborghini": ["Huracan","Revuelto","Urus"],
  "Land Rover": ["Defender","Discovery","Discovery Sport","Range Rover","Range Rover Evoque","Range Rover Sport","Range Rover Velar"],
  "Lexus": ["ES","GX","IS","LC","LS","LX","NX","RC","RX","TX","UX"],
  "Lincoln": ["Aviator","Corsair","Nautilus","Navigator"],
  "MINI": ["Clubman","Convertible","Cooper","Countryman","Hardtop"],
  "Maserati": ["Ghibli","GranTurismo","Grecale","Levante","MC20","Quattroporte"],
  "Mazda": ["BT-50","CX-3","CX-30","CX-5","CX-50","CX-9","CX-90","Demio","Mazda2","Mazda3","Mazda6","MX-5","MX-30"],
  "McLaren": ["570S","600LT","720S","750S","765LT","Artura","GT","P1"],
  "Mercedes-Benz": ["A-Class","AMG GT","B-Class","C-Class","CLA","CLS","E-Class","EQA","EQB","EQC","EQE","EQS","G-Class","GLA","GLB","GLC","GLE","GLS","Maybach S-Class","S-Class","SL","Sprinter","V-Class","Vito"],
  "Mitsubishi": ["ASX","Attrage","Eclipse Cross","L200","Lancer","Mirage","Montero","Outlander","Pajero","Pajero Sport","RVR","Triton","Xpander"],
  "Nissan": ["Altima","Ariya","Frontier","Juke","Kicks","March","Maxima","Murano","Navara","Note","NP300","Pathfinder","Patrol","Qashqai","Rogue","Sentra","Sunny","Sylphy","Tiida","Versa","X-Trail"],
  "Porsche": ["718","911","Cayenne","Cayenne Coupe","Macan","Panamera","Taycan"],
  "Ram": ["1500","2500","3500","ProMaster"],
  "Rolls-Royce": ["Cullinan","Dawn","Ghost","Phantom","Spectre","Wraith"],
  "Subaru": ["Ascent","Crosstrek","Forester","Impreza","Legacy","Levorg","Outback","Solterra","WRX","XV"],
  "Tesla": ["Cybertruck","Model 3","Model S","Model X","Model Y"],
  "Volkswagen": ["Amarok","Arteon","Atlas","Caddy","Crafter","Golf","ID.3","ID.4","ID.5","ID.Buzz","Jetta","Passat","Polo","T-Cross","T-Roc","Taos","Tiguan","Touareg","Transporter"],
  "Volvo": ["C40","EX30","EX90","S60","S90","V60","V90","XC40","XC60","XC90"],

  // ===== TIER 3: Classic, historic, and niche makes =====
  "AM General": ["Hummer H1"],
  "AMC": ["Ambassador","AMX","Concord","Eagle","Gremlin","Hornet","Javelin","Matador","Pacer","Rambler","Spirit"],
  "Auburn": ["851","852","876","8-100"],
  "Austin": ["A40","A55","Healey","Mini","Seven","Westminster"],
  "Austin-Healey": ["100","3000","Sprite"],
  "Bricklin": ["SV-1"],
  "Bugatti": ["Chiron","Divo","Mistral","Veyron"],
  "Caterham": ["Seven 160","Seven 270","Seven 310","Seven 420","Seven 480","Seven 620"],
  "Citroën": ["Berlingo","C-Elysée","C1","C3","C3 Aircross","C4","C4 X","C5","C5 Aircross","Jumper","Jumpy","SpaceTourer"],
  "Daewoo": ["Cielo","Espero","Lanos","Leganza","Matiz","Nexia","Nubira","Tico","Winstorm"],
  "Daihatsu": ["Ayla","Charade","Copen","Gran Max","Mira","Move","Rocky","Sirion","Terios","Xenia"],
  "Datsun": ["240Z","260Z","280Z","280ZX","510","620","Go","Go+","redi-GO"],
  "De Tomaso": ["Mangusta","Pantera"],
  "DeLorean": ["DMC-12"],
  "DeSoto": ["Adventurer","Airflow","Firedome","Fireflite"],
  "Durant": ["Model 40","Model 55","Model 60"],
  "Edsel": ["Citation","Corsair","Ranger","Villager"],
  "Excalibur": ["Series I","Series II","Series III","Series IV","Series V"],
  "Fisker": ["Karma","Ocean","Ronin"],
  "Freightliner": ["Cascadia","M2","Sprinter"],
  "Geo": ["Metro","Prizm","Storm","Tracker"],
  "Ghia": ["450 SS","L6.4"],
  "Graham": ["Blue Streak","Cavalier","Hollywood","Supercharger"],
  "Hudson": ["Commodore","Hornet","Pacemaker","Super Six","Wasp"],
  "Hummer": ["H1","H2","H3","HX"],
  "Imperial": ["Crown","LeBaron"],
  "Ineos": ["Grenadier","Quartermaster"],
  "Intermeccanica": ["Italia","Kubelwagen"],
  "International Harvester": ["Scout","Scout II","Travelall"],
  "Isuzu": ["Ascender","D-Max","ELF","Forward","Giga","Hombre","MU-X","N-Series","NMR","NPR","Panther","Rodeo","Trooper","VehiCross"],
  "Jensen": ["C-V8","FF","Healey","Interceptor"],
  "Karma": ["GS-6","Revero"],
  "Koenigsegg": ["Agera","CC8S","CCR","CCX","Gemera","Jesko","One:1","Regera"],
  "Lada": ["4x4","Granta","Largus","Niva","Niva Travel","Vesta","XRAY"],
  "Lancia": ["Delta","Fulvia","Stratos","Thesis","Ypsilon"],
  "Lexington": ["Minute Man","Thoroughbred"],
  "Lotus": ["Eletre","Elise","Emira","Esprit","Evija","Evora","Exige"],
  "Lucid": ["Air","Gravity"],
  "MG": ["3","4","5","Cyberster","Gloster","HS","Hector","MG4","MG5","ZS","ZS EV"],
  "Maybach": ["57","62","S-Class","GLS"],
  "Mercury": ["Cougar","Grand Marquis","Mariner","Milan","Montego","Mountaineer","Sable"],
  "Mobility Ventures": ["MV-1"],
  "Morgan": ["3 Wheeler","Aero 8","Plus Four","Plus Six","Super 3"],
  "Morris": ["Cowley","Minor","Mini","Oxford"],
  "Nash": ["Ambassador","Metropolitan","Rambler","Statesman"],
  "Oldsmobile": ["442","Alero","Aurora","Bravada","Cutlass","Delta 88","Intrigue","Silhouette","Toronado"],
  "Opel": ["Astra","Combo","Corsa","Crossland","Grandland","Insignia","Karl","Mokka","Vivaro","Zafira"],
  "Overland": ["Model 79","Model 93"],
  "Packard": ["Caribbean","Clipper","Hawk","Patrician","Super Eight"],
  "Pagani": ["Huayra","Utopia","Zonda"],
  "Paige": ["Model 6-45","Model 6-66"],
  "Panoz": ["AIV Roadster","Esperante","GTS"],
  "Peerless": ["GT"],
  "Peugeot": ["2008","206","207","208","3008","301","307","308","405","406","407","5008","508","Partner","Rifter"],
  "Pininfarina": ["Battista","Sergio"],
  "Plymouth": ["Barracuda","Belvedere","Duster","Fury","GTX","Neon","Road Runner","Satellite","Valiant","Voyager"],
  "Polestar": ["1","2","3","4","5"],
  "Pontiac": ["Aztek","Bonneville","Catalina","Firebird","G6","G8","Grand Am","Grand Prix","GTO","Solstice","Trans Am","Vibe"],
  "Qvale": ["Mangusta"],
  "Renault": ["Captur","Clio","Duster","Express","Kadjar","Kangoo","Koleos","Kwid","Logan","Megane","Oroch","Sandero","Symbol","Trafic"],
  "Rivian": ["R1S","R1T","R2","R3"],
  "Rover": ["25","45","75","Defender","P5","P6","SD1"],
  "SSC": ["Tuatara","Ultimate Aero"],
  "Saab": ["9-2X","9-3","9-4X","9-5","9-7X","900","9000"],
  "Saleen": ["Mustang S281","S302","S7"],
  "Saturn": ["Astra","Aura","Ion","L-Series","Outlook","Relay","S-Series","Sky","Vue"],
  "Scion": ["FR-S","iA","iM","iQ","tC","xA","xB","xD"],
  "Shelby": ["Cobra","GT350","GT500","Series 1"],
  "smart": ["EQ fortwo","forfour","fortwo","#1","#3"],
  "Studebaker": ["Avanti","Champion","Commander","Hawk","Lark","President","Starlight"],
  "Sunbeam": ["Alpine","Imp","Rapier","Tiger"],
  "Suzuki": ["Alto","Baleno","Celerio","Ciaz","Dzire","Ertiga","Grand Vitara","Ignis","Jimny","S-Cross","S-Presso","Swift","Vitara","Wagon R","XL7"],
  "Triumph": ["GT6","Herald","Spitfire","Stag","TR3","TR4","TR6","TR7","TR8"],
  "VPG": ["MV-1"],
  "VinFast": ["VF 5","VF 6","VF 7","VF 8","VF 9"],
  "White": ["5000","9000","Autocar"],
  "Willys": ["CJ-2A","CJ-3A","CJ-3B","CJ-5","Jeepster","MB","Station Wagon"],

  // ===== EAST AFRICAN MARKET — Chinese, Indian, Malaysian =====
  "BYD": ["Atto 3","Dolphin","e2","e6","Han","Han EV","Qin","Qin Plus","Seal","Seagull","Song Plus","Song Pro","Tang","Tang EV","Yuan Plus"],
  "Chery": ["Arrizo 5","Arrizo 6","Arrizo 7","Arrizo 8","Omoda 5","Omoda 7","Tiggo 2","Tiggo 3","Tiggo 4","Tiggo 5X","Tiggo 7","Tiggo 7 Pro","Tiggo 8","Tiggo 8 Pro","Tiggo 9","eQ1","eQ5"],
  "Geely": ["Azkarra","Coolray","Emgrand","Emgrand X7","Geometry C","GX3 Pro","Monjaro","Okavango","Preface","Starry","Tugella"],
  "Lifan": ["320","520","530","620","650","720","820","Myway","Solano","X50","X60","X70","X80"],
  "Great Wall": ["Cannon","Hover","Poer","Safe","Steed","Wingle 5","Wingle 7"],
  "Haval": ["Dargo","H1","H2","H4","H6","H9","Jolion","M6"],
  "JAC": ["iEV","J2","J3","J4","J5","J7","Refine","S2","S3","S4","S5","S7","Sunray","T6","T8","X200"],
  "TATA": ["Ace","Harrier","Indica","Indigo","LPT","Nano","Nexon","Prima","Punch","Safari","Super Ace","Tiago","Tigor","Ultra","Winger","Xenon"],
  "Mahindra": ["Bolero","KUV100","Marazzo","Pik-Up","Scorpio","Scorpio-N","Thar","TUV300","Verito","XUV300","XUV400","XUV500","XUV700"],
  "Proton": ["Exora","Iriz","Persona","Saga","X50","X70","X90"],
  "Changan": ["Alsvin","CS15","CS35","CS55","CS75","CS85","CX70","Eado","Hunter","Supervan","UNI-K","UNI-T","UNI-V"],
  "Dongfeng": ["AX7","Glory 580","Rich 6","S30","SX5","SX6"],
  "Foton": ["Aumark","Auman","Gratour","Sauvana","Toano","Tunland","View"],
  "BAIC": ["BJ40","D20","EU5","Senova X35","Senova X55","U5 Plus","X7"],
  "Zotye": ["T300","T500","T600","T700","Z100","Z300"],
  "Wuling": ["Almaz","Confero","Cortez","Formo","Hongguang Mini EV"],
  "SsangYong": ["Actyon","Korando","Musso","Rexton","Tivoli","Torres","XLV"],
  "Hino": ["300 Series","500 Series","700 Series","Dutro","Ranger"],
  "Shacman": ["F2000","F3000","H3000","X3000","X5000","X6000"],
  "Sinotruk": ["Howo","Hohan","Sitrak","T5G","T7H"],
  "Force": ["Gurkha","Trax","Traveller"],
  "Bajaj": ["Maxima","Qute","RE"],
};

let POPULAR_MAKES = Object.keys(MODELS_BY_MAKE).sort();
const TRIMS_BY_MODEL = {
  "BMW|3-Series": ["316i","320i","325i","328i","330i","335i","340i","M340i"],
  "Ford|F-150": ["XL","XLT","Lariat","King Ranch","Platinum","Limited","Raptor"],
  "Toyota|Camry": ["L","LE","SE","XLE","XSE","TRD","Hybrid LE","Hybrid SE","Hybrid XLE"],
};
const BODY_STYLES = ["Sedan","SUV / Crossover","Hatchback","Convertible","Van","Minivan","Pickup Truck","Coupe","Wagon"];

/* =========================================================================
   COUNTRY / LOCATION DATA
   ========================================================================= */

const COUNTRY_LIST = ["Ethiopia","Kenya","Uganda","Tanzania","Rwanda","Djibouti","Somalia","South Sudan"];

const COUNTRIES_DATA = {
  "Ethiopia": { flag: "🇪🇹", currency: "ETB", regions: ["Addis Ababa","Afar","Amhara","Benishangul-Gumuz","Dire Dawa","Gambela","Harari","Oromia","Sidama","Somali","South Ethiopia","South West Ethiopia","Tigray","Central Ethiopia"] },
  "Kenya": { flag: "🇰🇪", currency: "KES", regions: ["Nairobi","Mombasa","Kisumu","Nakuru","Uasin Gishu","Kiambu","Machakos","Kajiado","Kilifi","Meru","Nyeri","Kakamega"] },
  "Uganda": { flag: "🇺🇬", currency: "UGX", regions: ["Central","Eastern","Northern","Western"] },
  "Tanzania": { flag: "🇹🇿", currency: "TZS", regions: ["Dar es Salaam","Arusha","Mwanza","Dodoma","Mbeya","Morogoro","Tanga"] },
  "Rwanda": { flag: "🇷🇼", currency: "RWF", regions: ["Kigali","Eastern","Northern","Southern","Western"] },
  "Djibouti": { flag: "🇩🇯", currency: "DJF", regions: ["Djibouti","Ali Sabieh","Dikhil","Tadjourah","Obock","Arta"] },
  "Somalia": { flag: "🇸🇴", currency: "SOS", regions: ["Banadir","Awdal","Bari","Bay","Mudug","Nugaal","Woqooyi Galbeed"] },
  "South Sudan": { flag: "🇸🇸", currency: "SSP", regions: ["Central Equatoria","Eastern Equatoria","Jonglei","Unity","Upper Nile","Lakes","Warrap"] },
};

const CITIES_BY_COUNTRY_REGION = {
  "Ethiopia|Addis Ababa": ["Addis Ababa"],
  "Ethiopia|Amhara": ["Bahir Dar","Gondar","Dessie","Debre Birhan","Lalibela"],
  "Ethiopia|Oromia": ["Adama","Jimma","Bishoftu","Shashemene","Sebeta"],
  "Ethiopia|Sidama": ["Hawassa"],
  "Ethiopia|Tigray": ["Mekelle","Adigrat","Axum"],
  "Ethiopia|Dire Dawa": ["Dire Dawa"],
  "Kenya|Nairobi": ["Nairobi"],
  "Kenya|Mombasa": ["Mombasa"],
  "Kenya|Kisumu": ["Kisumu"],
  "Uganda|Central": ["Kampala","Entebbe","Mukono","Wakiso"],
  "Tanzania|Dar es Salaam": ["Dar es Salaam"],
  "Tanzania|Arusha": ["Arusha"],
  "Rwanda|Kigali": ["Kigali"],
};

const AREAS_BY_COUNTRY_CITY = {
  "Ethiopia|Addis Ababa": ["Bole","CMC","Megenagna","Sarbet","Kazanchis","Ayat","Old Airport","Piazza","Summit","Gerji","Saris","Mexico"],
  "Kenya|Nairobi": ["CBD","Westlands","Kilimani","Karen","Lavington","Runda","Parklands","Eastleigh"],
  "Kenya|Mombasa": ["Nyali","Bamburi","Mtwapa","Likoni","Kisauni"],
  "Tanzania|Dar es Salaam": ["Masaki","Oysterbay","Mikocheni","Kinondoni","Kariakoo","Upanga"],
  "Uganda|Central": ["Kampala Central","Nakasero","Kololo","Bugolobi","Naguru","Ntinda","Bukoto","Muyenga"],
  "Rwanda|Kigali": ["Kacyiru","Kimihurura","Remera","Nyamirambo","Gikondo","Kimironko"],
};

const PLATE_CODES_BY_COUNTRY = {
  "Ethiopia": [{code:"1",region:"Addis Ababa"},{code:"2",region:"Afar"},{code:"3",region:"Amhara"},{code:"4",region:"Oromia"},{code:"5",region:"Somali"},{code:"6",region:"Benishangul-Gumuz"},{code:"7",region:"South"},{code:"8",region:"Gambela"},{code:"9",region:"Harari"},{code:"10",region:"Dire Dawa"},{code:"11",region:"Tigray"}],
  "Kenya": [{code:"KAA",region:"Nairobi (older)"},{code:"KBA",region:"Nairobi"},{code:"KCA",region:"Nairobi"},{code:"KDA",region:"Nairobi"},{code:"GK",region:"Government"}],
};

const CURRENCY_BY_COUNTRY = {
  "Ethiopia":"ETB","Kenya":"KES","Uganda":"UGX","Tanzania":"TZS","Rwanda":"RWF","Djibouti":"DJF","Somalia":"SOS","South Sudan":"SSP",
};

function formatMoney(n, currency) {
  if (n == null) return "—";
  const c = currency || "ETB";
  if (n >= 1000000) return `${c} ${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${c} ${(n / 1000).toFixed(0)}K`;
  return `${c} ${n.toLocaleString()}`;
}

function regionsOf(country) { return (COUNTRIES_DATA[country] || {}).regions || []; }
function citiesOf(country, region) { return CITIES_BY_COUNTRY_REGION[`${country}|${region}`] || []; }
function areasOf(country, city) { return AREAS_BY_COUNTRY_CITY[`${country}|${city}`] || []; }
function platesOf(country) { return PLATE_CODES_BY_COUNTRY[country] || []; }

/* =========================================================================
   FILTER CONSTANTS / HELPERS
   ========================================================================= */

const PRICE_MIN_BOUND = 100000;
const PRICE_MAX_BOUND = 100000000;
const MILEAGE_MIN_BOUND = 0;
const MILEAGE_MAX_BOUND = 500000;
const YEAR_MIN_BOUND = 1959;
const YEAR_MAX_BOUND = 2030;

const EXTERIOR_COLORS = ["Black","White","Silver","Gray","Blue","Red","Green","Brown","Gold","Yellow","Orange","Purple"];
const INTERIOR_COLORS = ["Black","Gray","Beige","Brown","White","Red"];
const DRIVETRAINS = ["FWD","RWD","AWD","4WD"];
const TRANSMISSIONS = ["Automatic","Manual","CVT"];
const FUEL_TYPES = ["Gasoline","Diesel","Hybrid","Electric","Plug-in Hybrid","Flex Fuel"];
const ENGINE_OPTIONS = ["3 Cylinder","4 Cylinder","5 Cylinder","6 Cylinder","8 Cylinder","10 Cylinder","12 Cylinder","Electric"];
const FEATURE_LIST = ["Sunroof","Leather seats","Heated seats","Cooled seats","Bluetooth","Backup camera","Navigation","Apple CarPlay","Android Auto","Blind spot monitor","Lane keep assist","Adaptive cruise","Third row seats","Tow package"];
const SEAT_OPTIONS = ["2","4","5","6","7","8+"];
const DOOR_OPTIONS = ["2","3","4","5"];
const MPG_OPTIONS = [20,25,30,35,40];
const SELLER_TYPES = ["Dealer","Private seller"];
const DUTY_STATUS = ["Duty paid","Duty free","Customs cleared"];
const CONDITION_OPTIONS = ["New","Used"];

const SORT_OPTIONS = [
  { id: "best_match", label: "Best match" },
  { id: "best_deals", label: "Best deals" },
  { id: "price_low", label: "Price: Lowest first" },
  { id: "mileage_low", label: "Mileage: Lowest first" },
  { id: "price_high", label: "Price: Highest first" },
  { id: "mileage_high", label: "Mileage: Highest first" },
  { id: "year_newest", label: "Year: Newer vehicles first" },
  { id: "year_oldest", label: "Year: Older vehicles first" },
  { id: "listings_newest", label: "Listings: Newest first" },
  { id: "listings_oldest", label: "Listings: Oldest first" },
];

function matchesFilter(l, filters, query) {
  const q = (query || "").toLowerCase().trim();
  if (filters.make && l.make !== filters.make) return false;
  if (filters.model && l.model !== filters.model) return false;
  if (filters.trim && !String(l.trim || "").toLowerCase().includes(String(filters.trim).toLowerCase())) return false;
  if (filters.bodyStyle && l.bodyStyle !== filters.bodyStyle) return false;
  if (filters.priceMin != null && l.price < filters.priceMin) return false;
  if (filters.priceMax != null && l.price > filters.priceMax) return false;
  if (filters.mileageMin != null && l.mileage < filters.mileageMin) return false;
  if (filters.mileageMax != null && l.mileage > filters.mileageMax) return false;
  if (filters.yearMin != null && l.year < filters.yearMin) return false;
  if (filters.yearMax != null && l.year > filters.yearMax) return false;
  if (filters.exteriorColor && l.exteriorColor !== filters.exteriorColor) return false;
  if (filters.interiorColor && (l.interiorColor || "") !== filters.interiorColor) return false;
  if (filters.drivetrain && (l.drivetrain || "") !== filters.drivetrain) return false;
  if (filters.transmission) {
    const tx = String(l.transmission || "").toLowerCase();
    if (filters.transmission === "Automatic" && !/a|auto/.test(tx)) return false;
    if (filters.transmission === "Manual" && !/^m|manual/.test(tx)) return false;
    if (filters.transmission === "CVT" && !/cvt/.test(tx)) return false;
  }
  if (filters.fuelType && (l.fuelType || "") !== filters.fuelType) return false;
  if (filters.seats && String(l.seats || "") !== String(filters.seats)) return false;
  if (filters.doors && String(l.doors || "") !== String(filters.doors)) return false;
  if (filters.mpgMin != null && (l.mpg || 0) < filters.mpgMin) return false;
  if (filters.sellerType) {
    const wantDealer = filters.sellerType === "Dealer";
    if (!!l.dealer !== wantDealer) return false;
  }
  if (filters.features && filters.features.length) {
    for (const f of filters.features) {
      if (!(l.features || []).includes(f)) return false;
    }
  }
  if (filters.condition && (l.condition || "used").toLowerCase() !== filters.condition.toLowerCase()) return false;
  if (filters.country && (l.country || "Ethiopia") !== filters.country) return false;
  if (filters.region && (l.region || "") !== filters.region) return false;
  if (filters.city && (l.city || "") !== filters.city) return false;
  if (filters.area && (l.area || "") !== filters.area) return false;
  if (filters.dutyStatus && (l.dutyStatus || "") !== filters.dutyStatus) return false;
  if (filters.plateCode && (l.plateCode || "") !== filters.plateCode) return false;
  if (q) {
    const hay = `${l.year} ${l.make} ${l.model} ${l.trim || ""} ${l.bodyStyle || ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function countActiveFilters(filters) {
  let n = 0;
  ["make","model","trim","bodyStyle","exteriorColor","interiorColor","drivetrain","transmission","fuelType","engine","seats","doors","sellerType","condition","region","city","area","dutyStatus","plateCode"].forEach(k => { if (filters[k]) n++; });
  if ((filters.priceMin != null) || (filters.priceMax != null)) n++;
  if ((filters.mileageMin != null) || (filters.mileageMax != null)) n++;
  if ((filters.yearMin != null) || (filters.yearMax != null)) n++;
  if (filters.mpgMin) n++;
  if (filters.features && filters.features.length) n++;
  if (filters.country && filters.country !== "Ethiopia") n++;
  return n;
}

function sortListings(list, mode) {
  const arr = [...list];
  switch (mode) {
    case "best_deals": case "price_low": return arr.sort((a, b) => a.price - b.price);
    case "price_high": return arr.sort((a, b) => b.price - a.price);
    case "mileage_low": return arr.sort((a, b) => a.mileage - b.mileage);
    case "mileage_high": return arr.sort((a, b) => b.mileage - a.mileage);
    case "year_newest": return arr.sort((a, b) => b.year - a.year);
    case "year_oldest": return arr.sort((a, b) => a.year - b.year);
    case "listings_newest": return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    case "listings_oldest": return arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    default: return arr;
  }
}

function RangeSlider({ min, max, step = 1, valueMin, valueMax, onChange, format = (v) => v }) {
  const lo = Math.max(min, Math.min(valueMin == null ? min : valueMin, max));
  const hi = Math.max(min, Math.min(valueMax == null ? max : valueMax, max));
  const pct = (v) => ((v - min) / (max - min)) * 100;
  return (
    <div className="px-5 pt-4 pb-4">
      <div className="flex justify-between text-sm text-white mb-5 font-medium">
        <span>{format(lo)}</span><span>{format(hi)}</span>
      </div>
      <div className="relative h-6">
        <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 rounded-full bg-neutral-800" />
        <div className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-emerald-500" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
        <input type="range" min={min} max={max} step={step} value={lo}
          onChange={(e) => { const v = Math.min(Number(e.target.value), hi); onChange({ min: v, max: hi }); }}
          className="range-input absolute left-0 right-0 top-0 bottom-0 w-full h-6 appearance-none bg-transparent" />
        <input type="range" min={min} max={max} step={step} value={hi}
          onChange={(e) => { const v = Math.max(Number(e.target.value), lo); onChange({ min: lo, max: v }); }}
          className="range-input absolute left-0 right-0 top-0 bottom-0 w-full h-6 appearance-none bg-transparent" />
      </div>
    </div>
  );
}

/* =========================================================================
   SMALL UI PIECES
   ========================================================================= */

function CarPhoto({ seed = 1, src, className = "" }) {
  if (src) return <img src={src} alt="" className={`object-cover ${className}`} />;
  const palettes = [["#1e3a8a","#0ea5e9"],["#0f172a","#64748b"],["#312e81","#6366f1"],["#064e3b","#10b981"],["#7c2d12","#f59e0b"],["#450a0a","#ef4444"],["#1f2937","#9ca3af"],["#4c1d95","#a78bfa"]];
  const [a, b] = palettes[seed % palettes.length];
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)` }}>
      <div className="absolute inset-0 flex items-center justify-center">
        <Car className="w-24 h-24 text-white/30" strokeWidth={1.2} />
      </div>
    </div>
  );
}

function FilterChip({ children, onClick, icon: Icon, active }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-3.5 h-9 rounded-full border text-sm whitespace-nowrap transition ${active ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-neutral-700 bg-neutral-900 text-neutral-200"}`}>
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
}

function RadioDot({ active }) {
  return (
    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${active ? "border-emerald-500" : "border-neutral-600"}`}>
      {active && <div className="w-3 h-3 rounded-full bg-emerald-500" />}
    </div>
  );
}

function BottomSheet({ title, onClose, children }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed left-0 right-0 bottom-0 z-50 max-w-md mx-auto bg-neutral-950 border-t border-neutral-800 rounded-t-3xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-neutral-900 shrink-0">
          <div className="w-9" />
          <h3 className="text-white text-[16px] font-semibold">{title}</h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
        <div className="overflow-y-auto pb-20">{children}</div>
      </div>
    </>
  );
}

function getMainPhoto(listing) {
  if (listing.photos && listing.photos.length > 0) return listing.photos[0];
  return null;
}

/* =========================================================================
   LISTING CARD
   ========================================================================= */

function ListingCard({ listing, onOpen, saved, onToggleSave }) {
  const photo = getMainPhoto(listing);
  return (
    <div onClick={() => onOpen(listing)} className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden active:scale-[0.99] transition cursor-pointer">
      <div className="relative">
        <CarPhoto seed={listing.imageSeed || 1} src={photo} className="h-52 w-full" />
        <button onClick={(e) => { e.stopPropagation(); onToggleSave(listing.id); }} className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/60 backdrop-blur flex items-center justify-center">
          <Heart className={`w-5 h-5 ${saved ? "fill-red-500 text-red-500" : "text-white"}`} />
        </button>
        {listing.dealer && (
          <div className="absolute top-0 right-0">
            <div className="w-0 h-0 border-t-[56px] border-l-[56px] border-t-blue-600 border-l-transparent" />
          </div>
        )}
      </div>
      <div className="p-4">
        {listing.dealer && (
          <p className="text-xs text-neutral-400 mb-1.5 flex items-center gap-1">
            Sponsored by {listing.sellerName}
          </p>
        )}
        <div className="flex items-start justify-between">
          <h3 className="text-[17px] font-semibold text-white">{listing.year} {listing.make} {listing.model}</h3>
          <MoreVertical className="w-5 h-5 text-neutral-500 shrink-0" />
        </div>
        <p className="text-sm text-neutral-300 mt-1">
          {listing.trim || ""} · {listing.mileage >= 1000 ? `${Math.round(listing.mileage / 1000)}K` : listing.mileage} km
        </p>
        <div className="flex items-center gap-1 mt-1.5 text-sm text-neutral-400">
          <MapPin className="w-4 h-4" /><span>{listing.location || ""}</span>
        </div>
        <div className="flex items-end justify-between mt-3">
          {listing.financingAvailable ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-900/40 border border-emerald-800">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-300 font-medium">Financing available</span>
            </div>
          ) : <div />}
          <div className="text-right">
            <div className="text-xl font-semibold text-white">{formatMoney(listing.price, listing.currency)}</div>
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onOpen(listing); }} className="mt-4 w-full h-12 rounded-full bg-emerald-700 text-white font-medium">
          Check availability
        </button>
      </div>
    </div>
  );
}

/* =========================================================================
   AUTH GATE — full-screen for protected tabs
   ========================================================================= */

function AuthGate({ message, onSignIn }) {
  return (
    <div className="pb-28 px-6 pt-16 text-center">
      <div className="w-16 h-16 mx-auto rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center">
        <UserCircle2 className="w-8 h-8 text-neutral-400" />
      </div>
      <h2 className="mt-5 text-white text-xl font-semibold">Sign in required</h2>
      <p className="mt-2 text-neutral-400 text-sm">{message}</p>
      <button onClick={onSignIn} className="mt-6 w-full max-w-xs mx-auto h-12 rounded-full bg-emerald-700 text-white font-medium">
        Sign in / Register
      </button>
    </div>
  );
}

/* =========================================================================
   AUTH MODAL — Supabase email/password
   ========================================================================= */

function AuthModal({ open, mode, setMode, onClose, onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [resetSent, setResetSent] = useState(false);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      if (mode === "forgot") {
        await resetPassword(email.trim());
        setResetSent(true);
        setLoading(false);
        return;
      }
      if (mode === "signup") {
        await signUpWithEmail(email.trim(), password, { name: name.trim(), phone: phone.trim() });
        await signInWithEmail(email.trim(), password);
      } else {
        await signInWithEmail(email.trim(), password);
      }
      onSuccess?.();
      onClose();
      setEmail(""); setPassword(""); setName(""); setPhone(""); setResetSent(false);
    } catch (ex) {
      setErr(ex.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const title = mode === "signup" ? "Create account" : mode === "forgot" ? "Reset password" : "Sign in";

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-neutral-950 rounded-t-3xl sm:rounded-3xl border border-neutral-800 p-6 pb-10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">{title}</h2>
          <button onClick={() => { onClose(); setResetSent(false); setErr(""); }} className="text-neutral-400 hover:text-white p-2"><X className="w-5 h-5" /></button>
        </div>

        {mode === "forgot" && resetSent ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-700/20 border border-emerald-500/40 flex items-center justify-center mb-4">
              <Send className="w-6 h-6 text-emerald-400" />
            </div>
            <h3 className="text-white text-lg font-semibold">Check your email</h3>
            <p className="text-neutral-400 text-sm mt-2">We sent a password reset link to <strong className="text-white">{email}</strong>. Click the link in the email to set a new password.</p>
            <button onClick={() => { setMode("signin"); setResetSent(false); setErr(""); }}
              className="mt-6 w-full h-12 bg-neutral-900 hover:bg-neutral-800 rounded-xl text-white font-semibold border border-neutral-800">
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <>
                <div>
                  <label className="text-xs text-neutral-400 mb-1 block">Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                    className="w-full h-11 bg-neutral-900 border border-neutral-800 rounded-xl px-3 text-white"
                    placeholder="Your name" required />
                </div>
                <div>
                  <label className="text-xs text-neutral-400 mb-1 block">Phone (optional)</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                    className="w-full h-11 bg-neutral-900 border border-neutral-800 rounded-xl px-3 text-white"
                    placeholder="+251 91 234 5678" />
                </div>
              </>
            )}
            <div>
              <label className="text-xs text-neutral-400 mb-1 block">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full h-11 bg-neutral-900 border border-neutral-800 rounded-xl px-3 text-white"
                placeholder="you@example.com" required autoComplete="email" />
            </div>
            {mode !== "forgot" && (
              <div>
                <label className="text-xs text-neutral-400 mb-1 block">Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 bg-neutral-900 border border-neutral-800 rounded-xl px-3 text-white"
                  placeholder="At least 6 characters" required minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"} />
              </div>
            )}
            {err && <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</div>}
            <button type="submit" disabled={loading}
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl text-white font-semibold mt-2">
              {loading ? "Please wait…" : mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}
            </button>
          </form>
        )}

        {mode !== "forgot" && (
          <div className="text-center mt-6 text-sm text-neutral-400">
            {mode === "signup" ? (
              <>Already have an account?{" "}
                <button onClick={() => { setMode("signin"); setErr(""); }} className="text-emerald-400 font-semibold">Sign in</button>
              </>
            ) : (
              <>New to Mela Cars?{" "}
                <button onClick={() => { setMode("signup"); setErr(""); }} className="text-emerald-400 font-semibold">Create account</button>
              </>
            )}
          </div>
        )}
        {mode === "signin" && (
          <div className="text-center mt-3">
            <button onClick={() => { setMode("forgot"); setErr(""); setResetSent(false); }} className="text-neutral-500 text-sm underline underline-offset-2">
              Forgot password?
            </button>
          </div>
        )}
        {mode === "forgot" && !resetSent && (
          <div className="text-center mt-4 text-sm text-neutral-400">
            Remember your password?{" "}
            <button onClick={() => { setMode("signin"); setErr(""); }} className="text-emerald-400 font-semibold">Sign in</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SignInGate({ open, action, onClose, onSignIn, onSignUp }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-neutral-950 rounded-3xl border border-neutral-800 p-6">
        <h3 className="text-xl font-bold text-white mb-2">Sign in required</h3>
        <p className="text-neutral-400 text-sm mb-5">You need an account to {action || "do that"}.</p>
        <div className="space-y-2">
          <button onClick={onSignIn} className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-white font-semibold">Sign in</button>
          <button onClick={onSignUp} className="w-full h-12 bg-neutral-900 hover:bg-neutral-800 rounded-xl text-white font-semibold border border-neutral-800">Create account</button>
          <button onClick={onClose} className="w-full h-10 text-neutral-400 text-sm">Not now</button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   SCREEN: SHOP (LANDING)
   ========================================================================= */

function ShopLocationCard({ onApply }) {
  const [country, setCountry] = useState("Ethiopia");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const apply = () => onApply({ country, region: region || null, city: city || null, area: area || null });
  const selectCls = "w-full h-12 rounded-xl bg-neutral-950 border border-neutral-800 px-4 text-white text-sm outline-none focus:border-emerald-500";

  return (
    <div className="mt-8 mx-4 rounded-3xl overflow-hidden bg-gradient-to-b from-emerald-700 to-emerald-900 p-6 pb-8">
      <h2 className="text-center text-2xl font-bold text-white">Find cars near you</h2>
      <p className="text-center text-emerald-100 mt-1.5">Pick your country and area to see local listings.</p>
      <div className="mt-5 rounded-2xl bg-neutral-950 border border-neutral-800 p-4 space-y-3">
        <div>
          <div className="text-xs text-neutral-400 mb-1.5">Country</div>
          <select value={country} onChange={(e) => { setCountry(e.target.value); setRegion(""); setCity(""); setArea(""); }} className={selectCls}>
            {COUNTRY_LIST.map(c => <option key={c} value={c}>{(COUNTRIES_DATA[c]?.flag || "")} {c}</option>)}
          </select>
        </div>
        <div>
          <div className="text-xs text-neutral-400 mb-1.5">Region / Province</div>
          <select value={region} onChange={(e) => { setRegion(e.target.value); setCity(""); setArea(""); }} className={selectCls}>
            <option value="">Any region</option>
            {regionsOf(country).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {region && citiesOf(country, region).length > 0 && (
          <div>
            <div className="text-xs text-neutral-400 mb-1.5">City / Town</div>
            <select value={city} onChange={(e) => { setCity(e.target.value); setArea(""); }} className={selectCls}>
              <option value="">Any city</option>
              {citiesOf(country, region).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        {city && areasOf(country, city).length > 0 && (
          <div>
            <div className="text-xs text-neutral-400 mb-1.5">Area / Neighborhood</div>
            <select value={area} onChange={(e) => setArea(e.target.value)} className={selectCls}>
              <option value="">Any area</option>
              {areasOf(country, city).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}
        <button onClick={apply} className="mt-2 w-full h-12 rounded-full bg-emerald-700 text-white font-medium">Show cars in this area</button>
      </div>
    </div>
  );
}

function ShopScreen({ onSearchMakes, onSearchBodyStyles, onQuickSearch, onApplyLocation }) {
  const [query, setQuery] = useState("");
  const submit = () => onQuickSearch(query);
  return (
    <div className="pb-28">
      <div className="relative h-56 bg-gradient-to-b from-black via-emerald-950/40 to-neutral-950 overflow-hidden flex flex-col items-center justify-center">
        <h1 className="text-5xl font-bold text-white leading-tight tracking-tight text-center">
          Mela <span className="text-emerald-500">Cars</span>
        </h1>
        <p className="mt-3 text-neutral-300 text-[15px] tracking-wide">Discover your dream car</p>
      </div>
      <div className="px-5 pt-6 -mt-2">
        <div className="flex items-center gap-2 h-14 px-5 rounded-full border border-neutral-700 bg-neutral-950">
          <Search className="w-5 h-5 text-neutral-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Search make, model, trim, or bodystyle"
            className="flex-1 bg-transparent text-[15px] text-white placeholder:text-neutral-500 outline-none" />
          {query && <button onClick={submit} className="h-9 px-4 rounded-full bg-emerald-700 text-white text-sm font-medium shrink-0">Go</button>}
        </div>
        <button onClick={onSearchMakes} className="mt-7 w-full h-14 rounded-full bg-emerald-700 text-white text-[16px] font-medium">Shop Make/Model</button>
        <button onClick={onSearchBodyStyles} className="mt-3 w-full h-14 rounded-full border border-neutral-600 text-white text-[16px] font-medium">Shop Body Style</button>
      </div>
      <ShopLocationCard onApply={onApplyLocation} />
    </div>
  );
}

/* =========================================================================
   SCREEN: BROWSE / MODELS / TRIMS
   ========================================================================= */

function BrowseScreen({ initialTab, onBack, onPickMake, onPickBodyStyle }) {
  const [tab, setTab] = useState(initialTab || "make");
  const [query, setQuery] = useState("");
  const filteredMakes = useMemo(() => POPULAR_MAKES.filter(m => m.toLowerCase().includes(query.toLowerCase())), [query]);
  const filteredBodies = useMemo(() => BODY_STYLES.filter(m => m.toLowerCase().includes(query.toLowerCase())), [query]);
  return (
    <div className="pb-28">
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-neutral-200"><MapPin className="w-4 h-4" /><span className="text-[15px]">Ethiopia</span></div>
        <div className="flex items-center gap-1.5 text-neutral-200"><Car className="w-4 h-4" /><span className="text-[15px]">Used</span></div>
      </div>
      <div className="px-4 flex items-center gap-3">
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center"><ChevronLeft className="w-6 h-6 text-white" /></button>
        <div className="flex-1 flex items-center gap-3 h-12 px-4 rounded-full border border-neutral-700 bg-neutral-950">
          <Search className="w-5 h-5 text-neutral-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search make, model, trim, or bodystyle" className="flex-1 bg-transparent text-sm text-white placeholder:text-neutral-500 outline-none" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 border-b border-neutral-800">
        <button onClick={() => setTab("make")} className={`h-11 text-[15px] font-medium relative ${tab === "make" ? "text-emerald-400" : "text-neutral-400"}`}>
          Make/Model
          {tab === "make" && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-emerald-500" />}
        </button>
        <button onClick={() => setTab("body")} className={`h-11 text-[15px] font-medium relative ${tab === "body" ? "text-emerald-400" : "text-neutral-400"}`}>
          Body Style
          {tab === "body" && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-emerald-500" />}
        </button>
      </div>
      {tab === "make" ? (
        <div>
          <button onClick={() => onPickMake(null)} className="w-full text-left px-5 py-4 text-white font-semibold border-b border-neutral-900">See all cars</button>
          <div className="px-5 py-2 text-xs tracking-wider text-neutral-500 uppercase bg-neutral-900/40">Popular makes</div>
          {filteredMakes.map(m => (
            <button key={m} onClick={() => onPickMake(m)} className="w-full text-left px-5 py-4 text-white border-b border-neutral-900 active:bg-neutral-900">{m}</button>
          ))}
        </div>
      ) : (
        <div>
          {filteredBodies.map(b => (
            <button key={b} onClick={() => onPickBodyStyle(b)} className="w-full flex items-center justify-between px-5 py-5 border-b border-neutral-900 active:bg-neutral-900">
              <span className="text-white text-[15px]">{b}</span>
              <Car className="w-10 h-10 text-neutral-400" strokeWidth={1.2} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelsScreen({ make, onBack, onPickModel }) {
  const models = MODELS_BY_MAKE[make] || [];
  const [query, setQuery] = useState("");
  const filtered = models.filter(m => m.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="pb-28">
      <div className="relative px-5 pt-4 pb-4 flex items-center justify-center">
        <button onClick={onBack} className="absolute left-4 w-10 h-10 rounded-full border border-neutral-700 flex items-center justify-center"><ChevronLeft className="w-5 h-5 text-white" /></button>
        <h2 className="text-white text-[17px]">{make}</h2>
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-center gap-3 h-11 px-4 rounded-full border border-neutral-700 bg-neutral-950">
          <Search className="w-4 h-4 text-neutral-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${make} models`} className="flex-1 bg-transparent text-sm text-white placeholder:text-neutral-500 outline-none" />
        </div>
      </div>
      <button onClick={() => onPickModel(null)} className="w-full text-left px-5 py-4 text-white font-semibold border-y border-neutral-900">See all {make} cars</button>
      {filtered.length > 0 ? (
        <>
          <div className="px-5 py-2 text-xs tracking-wider text-neutral-500 uppercase bg-neutral-900/40">Models ({filtered.length})</div>
          {filtered.map(m => {
            const hasTrims = !!TRIMS_BY_MODEL[`${make}|${m}`];
            return (
              <button key={m} onClick={() => onPickModel(m)} className="w-full flex items-center justify-between px-5 py-4 text-white border-b border-neutral-900 active:bg-neutral-900">
                <span>{m}</span>{hasTrims && <ChevronRight className="w-4 h-4 text-neutral-500" />}
              </button>
            );
          })}
        </>
      ) : <div className="mt-10 text-center text-neutral-500 text-sm px-8">No models match "{query}".</div>}
    </div>
  );
}

function TrimsScreen({ make, model, onBack, onPickTrim }) {
  const trims = TRIMS_BY_MODEL[`${make}|${model}`] || [];
  return (
    <div className="pb-28">
      <div className="relative px-5 pt-4 pb-4 flex items-center justify-center">
        <button onClick={onBack} className="absolute left-4 w-10 h-10 rounded-full border border-neutral-700 flex items-center justify-center"><ChevronLeft className="w-5 h-5 text-white" /></button>
        <h2 className="text-white text-[17px]">{make} {model}</h2>
      </div>
      <button onClick={() => onPickTrim(null)} className="w-full text-left px-5 py-4 text-white font-semibold border-y border-neutral-900">All {model} trims</button>
      <div className="px-5 py-2 text-xs tracking-wider text-neutral-500 uppercase bg-neutral-900/40">Trims ({trims.length})</div>
      {trims.map(t => (
        <button key={t} onClick={() => onPickTrim(t)} className="w-full text-left px-5 py-4 text-white border-b border-neutral-900 active:bg-neutral-900">{t}</button>
      ))}
    </div>
  );
}

/* =========================================================================
   SCREEN: RESULTS
   ========================================================================= */

function ResultsScreen({ listings, query, filters, setFilters, sortMode, setSortMode, onBack, onOpen, savedIds, onToggleSave, onOpenFilters, onClearQuery, onSearchSubmit }) {
  const [showSort, setShowSort] = useState(false);
  const [showCondition, setShowCondition] = useState(false);
  const [searchDraft, setSearchDraft] = useState(query || "");
  useEffect(() => { setSearchDraft(query || ""); }, [query]);

  const results = useMemo(() => {
    const filtered = listings.filter(l => matchesFilter(l, filters, query));
    return sortListings(filtered, sortMode);
  }, [listings, query, filters, sortMode]);

  const label = query || filters.bodyStyle ||
    (filters.make && filters.model && filters.trim ? `${filters.make} ${filters.model} ${filters.trim}` :
     filters.make && filters.model ? `${filters.make} ${filters.model}` : filters.make) || "All cars";
  const activeCount = countActiveFilters(filters);

  return (
    <div className="pb-28">
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <button onClick={() => onOpenFilters("Location")} className="flex items-center gap-1.5 text-neutral-200">
          <MapPin className="w-4 h-4" /><span className="text-[15px]">{filters.area || filters.city || filters.region || filters.country || "Ethiopia"}</span>
        </button>
        <div className="text-neutral-300 text-[15px]">{results.length} results</div>
        <button onClick={() => setShowCondition(true)} className="flex items-center gap-1.5 text-neutral-200">
          <Car className="w-4 h-4" /><span className="text-[15px]">{filters.condition || "Used"}</span>
        </button>
      </div>
      <div className="px-4 flex items-center gap-3 mt-2">
        <button onClick={onBack}><ChevronLeft className="w-6 h-6 text-white" /></button>
        <div className="flex-1 flex items-center gap-3 h-12 px-4 rounded-full border border-neutral-700 bg-neutral-950">
          <Search className="w-5 h-5 text-neutral-400" />
          <input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSearchSubmit(searchDraft); }}
            placeholder={label} className="flex-1 bg-transparent text-sm text-white placeholder:text-neutral-500 outline-none" />
          {(searchDraft || query) && (
            <button onClick={() => { setSearchDraft(""); onClearQuery(); }} className="p-1"><X className="w-4 h-4 text-neutral-400" /></button>
          )}
        </div>
      </div>
      <div className="mt-4 px-4 flex items-center gap-2 overflow-x-auto no-scrollbar">
        <button onClick={() => setShowSort(true)} className="w-10 h-10 rounded-lg border border-neutral-700 flex items-center justify-center shrink-0">
          <ArrowUpDown className="w-4 h-4 text-white" />
        </button>
        <button onClick={() => onOpenFilters()} className="relative w-10 h-10 rounded-lg border border-neutral-700 flex items-center justify-center shrink-0">
          <SlidersHorizontal className="w-4 h-4 text-white" />
          {activeCount > 0 && (
            <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-700 text-white text-[10px] font-semibold flex items-center justify-center">{activeCount}</div>
          )}
        </button>
        <FilterChip onClick={() => onOpenFilters("Price & payment")} active={filters.priceMin != null || filters.priceMax != null}>Price</FilterChip>
        <FilterChip onClick={() => onOpenFilters("Mileage")} active={filters.mileageMin != null || filters.mileageMax != null}>Mileage</FilterChip>
        <FilterChip onClick={() => onOpenFilters("Years")} active={filters.yearMin != null || filters.yearMax != null}>Years</FilterChip>
        <FilterChip onClick={() => onOpenFilters("Exterior color")} active={!!filters.exteriorColor}>Color</FilterChip>
        <FilterChip onClick={() => onOpenFilters("Drivetrain")} active={!!filters.drivetrain}>Drivetrain</FilterChip>
        <FilterChip onClick={() => onOpenFilters("Fuel type")} active={!!filters.fuelType}>Fuel</FilterChip>
      </div>
      <div className="mt-4 px-4 space-y-4">
        {results.length === 0 ? (
          <div className="mt-20 text-center text-neutral-500">No listings match your search.</div>
        ) : results.map(l => (
          <ListingCard key={l.id} listing={l} onOpen={onOpen} saved={savedIds.includes(l.id)} onToggleSave={onToggleSave} />
        ))}
      </div>
      {showSort && (
        <BottomSheet title="Sort by" onClose={() => setShowSort(false)}>
          {SORT_OPTIONS.map(opt => (
            <button key={opt.id} onClick={() => { setSortMode(opt.id); setShowSort(false); }}
              className="w-full px-5 py-4 text-left flex items-center justify-between border-b border-neutral-900 active:bg-neutral-900">
              <span className="text-white text-[15px]">{opt.label}</span>
              <RadioDot active={sortMode === opt.id} />
            </button>
          ))}
        </BottomSheet>
      )}
      {showCondition && (
        <BottomSheet title="Car condition" onClose={() => setShowCondition(false)}>
          {["Used","New"].map(opt => (
            <button key={opt} onClick={() => { setFilters({ ...filters, condition: opt }); setShowCondition(false); }}
              className="w-full px-5 py-4 text-left flex items-center justify-between border-b border-neutral-900 active:bg-neutral-900">
              <span className="text-white text-[15px]">{opt}</span>
              <RadioDot active={(filters.condition || "Used") === opt} />
            </button>
          ))}
        </BottomSheet>
      )}
    </div>
  );
}

/* =========================================================================
   SCREEN: FILTERS
   ========================================================================= */

const FILTER_SECTIONS = [
  "Location","Make/Model","Condition","Trim","Price & payment","Mileage","Years","Exterior color","Interior color",
  "Drivetrain","Transmission","Body style","Fuel type","Engine","Features",
  "Number of seats","Number of doors","Gas mileage","Seller type","Duty status","Plate code",
];

function FiltersScreen({ filters, setFilters, onClose, onReset, resultCount, activeCount, initialOpenSection }) {
  const [open, setOpen] = useState(initialOpenSection || "Location");
  const upd = (k, v) => setFilters({ ...filters, [k]: v });
  const toggleFeature = (f) => {
    const curr = filters.features || [];
    const next = curr.includes(f) ? curr.filter(x => x !== f) : [...curr, f];
    setFilters({ ...filters, features: next.length ? next : null });
  };
  const chipCls = (on) => `px-3 h-9 rounded-full border text-sm ${on ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-neutral-700 text-neutral-200"}`;

  return (
    <div className="min-h-full pb-28">
      <div className="sticky top-0 z-10 bg-neutral-950/95 backdrop-blur px-5 pt-4 pb-3 flex items-center justify-between border-b border-neutral-900">
        <button onClick={onReset} className="px-4 h-9 rounded-full border border-neutral-700 text-neutral-200 text-sm underline underline-offset-2">
          Reset {activeCount > 0 ? `${activeCount} filter${activeCount === 1 ? "" : "s"}` : "filters"}
        </button>
        <h2 className="text-white text-[17px] font-semibold">Filters</h2>
        <button onClick={onClose} className="w-9 h-9 rounded-full border border-neutral-700 flex items-center justify-center"><X className="w-4 h-4 text-white" /></button>
      </div>
      <div className="px-5 pt-5">
        <h3 className="text-white font-semibold text-[15px]">Country</h3>
        <select value={filters.country || "Ethiopia"}
          onChange={(e) => setFilters({ ...filters, country: e.target.value, region: null, city: null, area: null, plateCode: null })}
          className="mt-3 w-full h-12 rounded-xl bg-neutral-900 border border-neutral-700 px-4 text-white text-sm outline-none focus:border-emerald-500">
          {COUNTRY_LIST.map(c => <option key={c} value={c}>{(COUNTRIES_DATA[c]?.flag || "")} {c}</option>)}
        </select>
      </div>
      <div className="mt-5 border-t border-neutral-900">
        {FILTER_SECTIONS.map(s => {
          const isOpen = open === s;
          return (
            <div key={s} className="border-b border-neutral-900">
              <button onClick={() => setOpen(isOpen ? null : s)} className="w-full flex items-center justify-between px-5 py-4 text-left">
                <span className="text-white text-[15px]">{s}</span>
                {isOpen ? <ChevronUp className="w-5 h-5 text-neutral-400" /> : <ChevronDown className="w-5 h-5 text-neutral-400" />}
              </button>
              {isOpen && s === "Location" && (
                <div className="px-5 pb-5 space-y-3">
                  <div>
                    <div className="text-xs text-neutral-400 mb-1.5">Region / Province</div>
                    <select value={filters.region || ""} onChange={(e) => setFilters({ ...filters, region: e.target.value || null, city: null, area: null })}
                      className="w-full h-11 rounded-xl bg-neutral-900 border border-neutral-800 px-4 text-white text-sm outline-none focus:border-emerald-500">
                      <option value="">Any region</option>
                      {regionsOf(filters.country || "Ethiopia").map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  {filters.region && citiesOf(filters.country || "Ethiopia", filters.region).length > 0 && (
                    <div>
                      <div className="text-xs text-neutral-400 mb-1.5">City / Town</div>
                      <select value={filters.city || ""} onChange={(e) => setFilters({ ...filters, city: e.target.value || null, area: null })}
                        className="w-full h-11 rounded-xl bg-neutral-900 border border-neutral-800 px-4 text-white text-sm outline-none focus:border-emerald-500">
                        <option value="">Any city</option>
                        {citiesOf(filters.country || "Ethiopia", filters.region).map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  )}
                  {filters.city && areasOf(filters.country || "Ethiopia", filters.city).length > 0 && (
                    <div>
                      <div className="text-xs text-neutral-400 mb-1.5">Area / Neighborhood</div>
                      <select value={filters.area || ""} onChange={(e) => upd("area", e.target.value || null)}
                        className="w-full h-11 rounded-xl bg-neutral-900 border border-neutral-800 px-4 text-white text-sm outline-none focus:border-emerald-500">
                        <option value="">Any area</option>
                        {areasOf(filters.country || "Ethiopia", filters.city).map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {isOpen && s === "Make/Model" && (
                <div className="px-5 pb-5 space-y-3">
                  <div>
                    <div className="text-xs text-neutral-400 mb-1.5">Make</div>
                    <select value={filters.make || ""} onChange={(e) => setFilters({ ...filters, make: e.target.value || null, model: null })}
                      className="w-full h-11 rounded-xl bg-neutral-900 border border-neutral-800 px-4 text-white text-sm outline-none focus:border-emerald-500">
                      <option value="">Any make</option>
                      {POPULAR_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  {filters.make && MODELS_BY_MAKE[filters.make] && (
                    <div>
                      <div className="text-xs text-neutral-400 mb-1.5">Model</div>
                      <select value={filters.model || ""} onChange={(e) => upd("model", e.target.value || null)}
                        className="w-full h-11 rounded-xl bg-neutral-900 border border-neutral-800 px-4 text-white text-sm outline-none focus:border-emerald-500">
                        <option value="">Any model</option>
                        {MODELS_BY_MAKE[filters.make].map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {isOpen && s === "Condition" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {CONDITION_OPTIONS.map(v => <button key={v} onClick={() => upd("condition", filters.condition === v ? null : v)} className={chipCls(filters.condition === v) + " min-w-[80px]"}>{v}</button>)}
                </div>
              )}
              {isOpen && s === "Trim" && (
                <div className="px-5 pb-5">
                  <input type="text" value={filters.trim || ""} onChange={(e) => upd("trim", e.target.value || null)}
                    placeholder="e.g. Sport, Limited, 320i"
                    className="w-full h-11 rounded-xl bg-neutral-900 border border-neutral-800 px-4 text-white text-sm outline-none focus:border-emerald-500" />
                </div>
              )}
              {isOpen && s === "Price & payment" && (
                <RangeSlider min={PRICE_MIN_BOUND} max={PRICE_MAX_BOUND} step={1000}
                  valueMin={filters.priceMin == null ? PRICE_MIN_BOUND : filters.priceMin}
                  valueMax={filters.priceMax == null ? PRICE_MAX_BOUND : filters.priceMax}
                  format={(v) => formatMoney(v, CURRENCY_BY_COUNTRY[filters.country || "Ethiopia"])}
                  onChange={({ min, max }) => setFilters({ ...filters, priceMin: min === PRICE_MIN_BOUND ? null : min, priceMax: max === PRICE_MAX_BOUND ? null : max })} />
              )}
              {isOpen && s === "Mileage" && (
                <RangeSlider min={MILEAGE_MIN_BOUND} max={MILEAGE_MAX_BOUND} step={1000}
                  valueMin={filters.mileageMin == null ? MILEAGE_MIN_BOUND : filters.mileageMin}
                  valueMax={filters.mileageMax == null ? MILEAGE_MAX_BOUND : filters.mileageMax}
                  format={(v) => v.toLocaleString() + " km"}
                  onChange={({ min, max }) => setFilters({ ...filters, mileageMin: min === MILEAGE_MIN_BOUND ? null : min, mileageMax: max === MILEAGE_MAX_BOUND ? null : max })} />
              )}
              {isOpen && s === "Years" && (
                <RangeSlider min={YEAR_MIN_BOUND} max={YEAR_MAX_BOUND} step={1}
                  valueMin={filters.yearMin == null ? YEAR_MIN_BOUND : filters.yearMin}
                  valueMax={filters.yearMax == null ? YEAR_MAX_BOUND : filters.yearMax}
                  format={(v) => String(v)}
                  onChange={({ min, max }) => setFilters({ ...filters, yearMin: min === YEAR_MIN_BOUND ? null : min, yearMax: max === YEAR_MAX_BOUND ? null : max })} />
              )}
              {isOpen && s === "Exterior color" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {EXTERIOR_COLORS.map(v => <button key={v} onClick={() => upd("exteriorColor", filters.exteriorColor === v ? null : v)} className={chipCls(filters.exteriorColor === v)}>{v}</button>)}
                </div>
              )}
              {isOpen && s === "Interior color" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {INTERIOR_COLORS.map(v => <button key={v} onClick={() => upd("interiorColor", filters.interiorColor === v ? null : v)} className={chipCls(filters.interiorColor === v)}>{v}</button>)}
                </div>
              )}
              {isOpen && s === "Drivetrain" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {DRIVETRAINS.map(v => <button key={v} onClick={() => upd("drivetrain", filters.drivetrain === v ? null : v)} className={chipCls(filters.drivetrain === v)}>{v}</button>)}
                </div>
              )}
              {isOpen && s === "Transmission" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {TRANSMISSIONS.map(v => <button key={v} onClick={() => upd("transmission", filters.transmission === v ? null : v)} className={chipCls(filters.transmission === v)}>{v}</button>)}
                </div>
              )}
              {isOpen && s === "Body style" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {BODY_STYLES.map(v => <button key={v} onClick={() => upd("bodyStyle", filters.bodyStyle === v ? null : v)} className={chipCls(filters.bodyStyle === v)}>{v}</button>)}
                </div>
              )}
              {isOpen && s === "Fuel type" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {FUEL_TYPES.map(v => <button key={v} onClick={() => upd("fuelType", filters.fuelType === v ? null : v)} className={chipCls(filters.fuelType === v)}>{v}</button>)}
                </div>
              )}
              {isOpen && s === "Engine" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {ENGINE_OPTIONS.map(v => <button key={v} onClick={() => upd("engine", filters.engine === v ? null : v)} className={chipCls(filters.engine === v)}>{v}</button>)}
                </div>
              )}
              {isOpen && s === "Features" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {FEATURE_LIST.map(v => {
                    const on = (filters.features || []).includes(v);
                    return <button key={v} onClick={() => toggleFeature(v)} className={chipCls(on)}>{v}</button>;
                  })}
                </div>
              )}
              {isOpen && s === "Number of seats" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {SEAT_OPTIONS.map(v => <button key={v} onClick={() => upd("seats", filters.seats === v ? null : v)} className={chipCls(filters.seats === v) + " min-w-[52px]"}>{v}</button>)}
                </div>
              )}
              {isOpen && s === "Number of doors" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {DOOR_OPTIONS.map(v => <button key={v} onClick={() => upd("doors", filters.doors === v ? null : v)} className={chipCls(filters.doors === v) + " min-w-[52px]"}>{v}</button>)}
                </div>
              )}
              {isOpen && s === "Gas mileage" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {MPG_OPTIONS.map(v => <button key={v} onClick={() => upd("mpgMin", filters.mpgMin === v ? null : v)} className={chipCls(filters.mpgMin === v)}>{v}+ mpg</button>)}
                </div>
              )}
              {isOpen && s === "Seller type" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {SELLER_TYPES.map(v => <button key={v} onClick={() => upd("sellerType", filters.sellerType === v ? null : v)} className={chipCls(filters.sellerType === v)}>{v}</button>)}
                </div>
              )}
              {isOpen && s === "Duty status" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {DUTY_STATUS.map(v => <button key={v} onClick={() => upd("dutyStatus", filters.dutyStatus === v ? null : v)} className={chipCls(filters.dutyStatus === v)}>{v}</button>)}
                </div>
              )}
              {isOpen && s === "Plate code" && (
                <div className="px-5 pb-5 flex gap-2 flex-wrap">
                  {platesOf(filters.country || "Ethiopia").map(p => (
                    <button key={p.code} onClick={() => upd("plateCode", filters.plateCode === p.code ? null : p.code)} className={chipCls(filters.plateCode === p.code)}>
                      {p.code} · {p.region}
                    </button>
                  ))}
                  {platesOf(filters.country || "Ethiopia").length === 0 && <p className="text-neutral-500 text-sm">No plate code data for this country yet.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-gradient-to-t from-neutral-950 to-transparent">
        <button onClick={onClose} className="w-full h-12 rounded-full bg-emerald-700 text-white font-medium">See results ({resultCount})</button>
      </div>
    </div>
  );
}

/* =========================================================================
   SCREEN: DETAIL
   ========================================================================= */

function DetailScreen({ listing, onBack, saved, onToggleSave, onDelete, onMessageSeller, currentUserId, requireAuth }) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const photos = listing.photos || [];
  const hasPhotos = photos.length > 0;
  const isOwner = currentUserId && listing.sellerId === currentUserId;

  return (
    <div className="pb-28">
      <div className="relative">
        {hasPhotos ? (
          <>
            <img src={photos[photoIdx]} alt="" className="h-72 w-full object-cover" />
            {photos.length > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {photos.map((_, i) => (
                  <button key={i} onClick={() => setPhotoIdx(i)} className={`w-2 h-2 rounded-full ${i === photoIdx ? "bg-white" : "bg-white/40"}`} />
                ))}
              </div>
            )}
          </>
        ) : <CarPhoto seed={listing.imageSeed || 1} className="h-72 w-full" />}
        <button onClick={onBack} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center"><ChevronLeft className="w-5 h-5 text-white" /></button>
        <button onClick={() => onToggleSave(listing.id)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center"><Heart className={`w-5 h-5 ${saved ? "fill-red-500 text-red-500" : "text-white"}`} /></button>
      </div>
      <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-900/30 border border-amber-800 text-amber-200 text-xs leading-relaxed">
        ⚠️ Safety: Always meet in a public place. Never send money before seeing the car. Verify documents before paying.
      </div>
      <div className="px-5 pt-5">
        <h1 className="text-white text-2xl font-semibold">{listing.year} {listing.make} {listing.model}</h1>
        <p className="text-neutral-300 mt-1">{listing.trim}</p>
        <div className="flex items-center gap-1 mt-2 text-neutral-400 text-sm"><MapPin className="w-4 h-4" /><span>{listing.location}</span></div>
        {listing.landmark && <div className="text-neutral-500 text-xs mt-1 ml-5">{listing.landmark}</div>}
        {listing.gpsLat != null && (
          <a href={`https://www.google.com/maps/search/?api=1&query=${listing.gpsLat},${listing.gpsLng}`} target="_blank" rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-emerald-400 text-xs underline">
            <MapPin className="w-3 h-3" /> Open in Google Maps
          </a>
        )}
        <div className="flex items-end justify-between mt-4">
          {listing.financingAvailable ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-900/40 border border-emerald-800">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm text-emerald-300 font-medium">Financing available</span>
            </div>
          ) : <div />}
          <div className="text-right"><div className="text-3xl font-bold text-white">{formatMoney(listing.price, listing.currency)}</div></div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-neutral-800 p-3"><div className="text-xs text-neutral-400">Mileage</div><div className="text-white font-medium mt-0.5">{listing.mileage.toLocaleString()} km</div></div>
          <div className="rounded-xl border border-neutral-800 p-3"><div className="text-xs text-neutral-400">Body</div><div className="text-white font-medium mt-0.5">{listing.bodyStyle || "—"}</div></div>
          <div className="rounded-xl border border-neutral-800 p-3"><div className="text-xs text-neutral-400">Year</div><div className="text-white font-medium mt-0.5">{listing.year}</div></div>
          <div className="rounded-xl border border-neutral-800 p-3"><div className="text-xs text-neutral-400">Exterior</div><div className="text-white font-medium mt-0.5">{listing.exteriorColor || "—"}</div></div>
          {listing.engine && <div className="rounded-xl border border-neutral-800 p-3"><div className="text-xs text-neutral-400">Engine</div><div className="text-white font-medium mt-0.5">{listing.engine}</div></div>}
          {listing.power && <div className="rounded-xl border border-neutral-800 p-3"><div className="text-xs text-neutral-400">Power</div><div className="text-white font-medium mt-0.5">{listing.power} hp</div></div>}
          {listing.transmission && <div className="rounded-xl border border-neutral-800 p-3"><div className="text-xs text-neutral-400">Transmission</div><div className="text-white font-medium mt-0.5">{listing.transmission}</div></div>}
          {listing.drivetrain && <div className="rounded-xl border border-neutral-800 p-3"><div className="text-xs text-neutral-400">Drivetrain</div><div className="text-white font-medium mt-0.5">{listing.drivetrain}</div></div>}
          {listing.dutyStatus && <div className="rounded-xl border border-neutral-800 p-3"><div className="text-xs text-neutral-400">Duty status</div><div className="text-white font-medium mt-0.5">{listing.dutyStatus}</div></div>}
          {listing.plateCode && <div className="rounded-xl border border-neutral-800 p-3"><div className="text-xs text-neutral-400">Plate code</div><div className="text-white font-medium mt-0.5">Code {listing.plateCode}</div></div>}
        </div>
        {listing.features && listing.features.length > 0 && (
          <div className="mt-5">
            <h3 className="text-white font-semibold">Features</h3>
            <div className="mt-2 flex gap-2 flex-wrap">
              {listing.features.map(f => <span key={f} className="px-3 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-200 text-xs">{f}</span>)}
            </div>
          </div>
        )}
        {listing.description && (
          <div className="mt-5">
            <h3 className="text-white font-semibold">Description</h3>
            <p className="text-neutral-300 text-sm mt-2 leading-relaxed">{listing.description}</p>
          </div>
        )}
        <div className="mt-5 rounded-2xl border border-neutral-800 p-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-neutral-800 flex items-center justify-center"><UserCircle2 className="w-6 h-6 text-neutral-300" /></div>
            <div className="flex-1">
              <div className="text-white font-medium">{listing.sellerName}</div>
              <div className="text-neutral-400 text-xs">{listing.dealer ? "Dealer" : "Private seller"}</div>
            </div>
          </div>
          {!isOwner && (
            <button onClick={() => { if (requireAuth()) onMessageSeller(listing); }} className="mt-4 w-full h-12 rounded-full bg-emerald-700 text-white font-medium flex items-center justify-center gap-2">
              <MessageCircle className="w-4 h-4" /> Message seller
            </button>
          )}
          {listing.sellerPhone && !isOwner && (
            <a href={`tel:${listing.sellerPhone}`} className="mt-2 w-full h-12 rounded-full border border-neutral-700 text-white font-medium flex items-center justify-center gap-2">
              <Phone className="w-4 h-4" /> {listing.sellerPhone}
            </a>
          )}
        </div>
        {!isOwner && (
          <button onClick={() => { if (requireAuth()) setShowReport(true); }} className="mt-3 w-full h-11 rounded-full border border-neutral-800 text-neutral-400 text-sm flex items-center justify-center gap-2">
            <Flag className="w-4 h-4" /> Report this listing
          </button>
        )}
        {showReport && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => setShowReport(false)}>
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md mx-auto bg-neutral-950 border-t border-neutral-800 rounded-t-3xl p-5 pb-24">
              <h3 className="text-white font-semibold text-lg">{reportSubmitted ? "Report submitted" : "Why are you reporting this listing?"}</h3>
              {reportSubmitted ? (
                <div className="mt-4 text-neutral-300 text-sm">Thanks. Our team will review it shortly.</div>
              ) : (
                <div className="mt-4 space-y-2">
                  {[["scam","Suspected scam"],["fake","Fake or stolen vehicle"],["wrong","Wrong information"],["sold","Already sold"],["other","Other"]].map(([id, label]) => (
                    <button key={id} onClick={async () => {
                      try {
                        await submitReport(listing.id, currentUserId, id);
                        setReportSubmitted(true);
                      } catch (e) {
                        alert("Could not submit report: " + e.message);
                      }
                    }} className="w-full p-4 rounded-xl border border-neutral-800 text-left text-white active:bg-neutral-900">{label}</button>
                  ))}
                </div>
              )}
              <button onClick={() => { setShowReport(false); setReportSubmitted(false); }} className="mt-3 w-full h-12 text-neutral-400">Close</button>
            </div>
          </div>
        )}
        {onDelete && isOwner && (
          <button onClick={() => onDelete(listing.id)} className="mt-4 w-full h-12 rounded-full border border-red-900 text-red-400 font-medium flex items-center justify-center gap-2">
            <Trash2 className="w-4 h-4" /> Delete my listing
          </button>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   SCREEN: SELL
   ========================================================================= */

function SellScreen({ onCreate, currentUserId, currentProfile, onSignIn }) {
  if (!currentUserId) return <AuthGate message="Sign in to post a vehicle for sale." onSignIn={onSignIn} />;

  const [form, setForm] = useState({
    year: "", make: "", model: "", trim: "",
    mileage: "", price: "",
    country: "Ethiopia", region: "", city: "", area: "", landmark: "",
    gpsLat: null, gpsLng: null,
    plateCode: "", dutyStatus: "Duty paid",
    bodyStyle: "Sedan", fuelType: "Gasoline", drivetrain: "FWD", transmission: "Automatic",
    engine: "", power: "",
    exteriorColor: "", interiorColor: "",
    seats: "", doors: "", mpg: "",
    description: "", financingAvailable: false,
    features: [], photos: [],
  });
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef(null);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const onFiles = async (files) => {
    const arr = Array.from(files || []);
    if (arr.length === 0) return;
    setUploading(true);
    try {
      const urls = [];
      for (const file of arr) {
        const url = await uploadPhoto(file);
        urls.push(url);
      }
      setForm(p => ({ ...p, photos: [...p.photos, ...urls] }));
    } catch (e) {
      alert("Photo upload failed: " + e.message);
    } finally {
      setUploading(false);
    }
  };
  const removePhoto = (i) => setForm(p => ({ ...p, photos: p.photos.filter((_, j) => j !== i) }));
  const toggleFeature = (f) => {
    const has = form.features.includes(f);
    set("features", has ? form.features.filter(x => x !== f) : [...form.features, f]);
  };

  const submit = async () => {
    if (!form.year || !form.make || !form.model || !form.price) { setErr("Year, make, model, and price are required."); return; }
    setErr(""); setPosting(true);
    const locationStr = form.area ? `${form.area}, ${form.city || ""}` : (form.city || form.region || form.country);
    try {
      await onCreate({
        year: parseInt(form.year, 10),
        make: form.make.trim(),
        model: form.model.trim(),
        trim: form.trim.trim() || null,
        mileage: parseInt(form.mileage || 0, 10),
        price: parseInt(form.price, 10),
        currency: CURRENCY_BY_COUNTRY[form.country] || "ETB",
        country: form.country,
        region: form.region || null,
        city: form.city || null,
        area: form.area || null,
        location: locationStr,
        landmark: form.landmark.trim() || null,
        gpsLat: form.gpsLat,
        gpsLng: form.gpsLng,
        plateCode: form.plateCode || null,
        dutyStatus: form.dutyStatus || null,
        bodyStyle: form.bodyStyle,
        fuelType: form.fuelType,
        drivetrain: form.drivetrain,
        transmission: form.transmission,
        engine: form.engine.trim() || null,
        power: form.power ? parseInt(form.power, 10) : null,
        exteriorColor: form.exteriorColor || null,
        interiorColor: form.interiorColor || null,
        seats: form.seats || null,
        doors: form.doors || null,
        mpg: form.mpg ? parseInt(form.mpg, 10) : null,
        description: form.description.trim(),
        features: form.features,
        photos: form.photos,
        financingAvailable: !!form.financingAvailable,
        condition: "used",
        status: "active",
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setPosting(false);
    }
  };

  const inputCls = "mt-1.5 w-full h-12 rounded-xl bg-neutral-900 border border-neutral-800 px-4 text-white text-sm outline-none focus:border-emerald-500";
  const selectCls = inputCls;
  const chipCls = (on) => `px-3 h-9 rounded-full border text-sm ${on ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-neutral-700 text-neutral-200"}`;

  return (
    <div className="pb-32">
      <div className="px-5 pt-5 pb-3">
        <h1 className="text-white text-2xl font-bold">Sell your car</h1>
        <p className="text-neutral-400 text-sm mt-1">Post a listing — buyers can message you directly.</p>
      </div>
      <div className="px-5 space-y-4">
        <div>
          <div className="text-sm text-white font-semibold mb-2">Photos</div>
          <div className="grid grid-cols-3 gap-2">
            {form.photos.map((p, i) => (
              <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-neutral-800">
                <img src={p} alt="" className="w-full h-full object-cover" />
                {i === 0 && <div className="absolute top-1 left-1 px-2 py-0.5 rounded-full bg-emerald-700 text-white text-[10px] font-semibold">Main</div>}
                <button onClick={() => removePhoto(i)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center"><X className="w-3.5 h-3.5 text-white" /></button>
              </div>
            ))}
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="aspect-square rounded-xl border-2 border-dashed border-neutral-700 flex flex-col items-center justify-center text-neutral-400 active:bg-neutral-900 disabled:opacity-50">
              <Camera className="w-6 h-6" />
              <span className="text-[11px] mt-1">{uploading ? "Uploading…" : "Add photos"}</span>
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
          <p className="text-xs text-neutral-500 mt-2">First photo is the main photo shown on the listing card.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-neutral-400">Year *</span><input type="number" value={form.year} onChange={(e) => set("year", e.target.value)} placeholder="2022" className={inputCls} /></label>
          <label className="block"><span className="text-xs text-neutral-400">Make *</span>
            <select value={form.make} onChange={(e) => set("make", e.target.value)} className={selectCls}>
              <option value="">Select make</option>
              {POPULAR_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-neutral-400">Model *</span>
            {form.make && MODELS_BY_MAKE[form.make] ? (
              <select value={form.model} onChange={(e) => set("model", e.target.value)} className={selectCls}>
                <option value="">Select model</option>
                {MODELS_BY_MAKE[form.make].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : <input value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="Accord" className={inputCls} />}
          </label>
          <label className="block"><span className="text-xs text-neutral-400">Trim</span><input value={form.trim} onChange={(e) => set("trim", e.target.value)} placeholder="EX-L" className={inputCls} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-neutral-400">Mileage (km)</span><input type="number" value={form.mileage} onChange={(e) => set("mileage", e.target.value)} placeholder="65000" className={inputCls} /></label>
          <label className="block"><span className="text-xs text-neutral-400">Price ({CURRENCY_BY_COUNTRY[form.country] || "ETB"}) *</span><input type="number" value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="2500000" className={inputCls} /></label>
        </div>
        <div className="pt-2 border-t border-neutral-900"><h3 className="text-white font-semibold">Location</h3></div>
        <label className="block"><span className="text-xs text-neutral-400">Country *</span>
          <select value={form.country} onChange={(e) => setForm(p => ({ ...p, country: e.target.value, region: "", city: "", area: "", plateCode: "" }))} className={selectCls}>
            {COUNTRY_LIST.map(c => <option key={c} value={c}>{(COUNTRIES_DATA[c]?.flag || "")} {c}</option>)}
          </select>
        </label>
        <label className="block"><span className="text-xs text-neutral-400">Region / Province *</span>
          <select value={form.region} onChange={(e) => setForm(p => ({ ...p, region: e.target.value, city: "", area: "" }))} className={selectCls}>
            <option value="">Select region</option>
            {regionsOf(form.country).map(r => <option key={r}>{r}</option>)}
          </select>
        </label>
        {form.region && citiesOf(form.country, form.region).length > 0 && (
          <label className="block"><span className="text-xs text-neutral-400">City / Town *</span>
            <select value={form.city} onChange={(e) => setForm(p => ({ ...p, city: e.target.value, area: "" }))} className={selectCls}>
              <option value="">Select city</option>
              {citiesOf(form.country, form.region).map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
        )}
        {form.city && areasOf(form.country, form.city).length > 0 && (
          <label className="block"><span className="text-xs text-neutral-400">Area / Neighborhood</span>
            <select value={form.area} onChange={(e) => set("area", e.target.value)} className={selectCls}>
              <option value="">Select area</option>
              {areasOf(form.country, form.city).map(a => <option key={a}>{a}</option>)}
            </select>
          </label>
        )}
        <label className="block"><span className="text-xs text-neutral-400">Landmark (helps buyers find you)</span><input value={form.landmark} onChange={(e) => set("landmark", e.target.value)} placeholder="e.g. Near Bole Medhanealem Church" className={inputCls} /></label>
        <div>
          <div className="text-xs text-neutral-400 mb-1.5">GPS pin (optional)</div>
          {form.gpsLat != null ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-12 rounded-xl bg-neutral-900 border border-neutral-800 px-4 flex items-center text-white text-sm">
                <MapPin className="w-4 h-4 text-emerald-400 mr-2" />
                {form.gpsLat.toFixed(5)}, {form.gpsLng.toFixed(5)}
              </div>
              <button type="button" onClick={() => setForm(p => ({ ...p, gpsLat: null, gpsLng: null }))} className="h-12 px-4 rounded-xl border border-neutral-700 text-neutral-300 text-sm">Clear</button>
            </div>
          ) : (
            <button type="button" onClick={() => {
              if (!navigator.geolocation) { alert("Geolocation is not supported on this device."); return; }
              navigator.geolocation.getCurrentPosition(
                (pos) => setForm(p => ({ ...p, gpsLat: pos.coords.latitude, gpsLng: pos.coords.longitude })),
                () => alert("Could not get your location.")
              );
            }} className="w-full h-12 rounded-xl border border-dashed border-neutral-700 text-neutral-300 text-sm flex items-center justify-center gap-2">
              <MapPin className="w-4 h-4" /> Use current location
            </button>
          )}
        </div>
        <div className="pt-2 border-t border-neutral-900"><h3 className="text-white font-semibold">Specifications</h3></div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-neutral-400">Body style</span>
            <select value={form.bodyStyle} onChange={(e) => set("bodyStyle", e.target.value)} className={selectCls}>{BODY_STYLES.map(b => <option key={b}>{b}</option>)}</select>
          </label>
          <label className="block"><span className="text-xs text-neutral-400">Fuel type</span>
            <select value={form.fuelType} onChange={(e) => set("fuelType", e.target.value)} className={selectCls}>{FUEL_TYPES.map(f => <option key={f}>{f}</option>)}</select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-neutral-400">Drivetrain</span>
            <select value={form.drivetrain} onChange={(e) => set("drivetrain", e.target.value)} className={selectCls}>{DRIVETRAINS.map(d => <option key={d}>{d}</option>)}</select>
          </label>
          <label className="block"><span className="text-xs text-neutral-400">Transmission</span>
            <select value={form.transmission} onChange={(e) => set("transmission", e.target.value)} className={selectCls}>{TRANSMISSIONS.map(t => <option key={t}>{t}</option>)}</select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-neutral-400">Engine</span><input value={form.engine} onChange={(e) => set("engine", e.target.value)} placeholder="2.0L Turbo I4" className={inputCls} /></label>
          <label className="block"><span className="text-xs text-neutral-400">Horsepower</span><input type="number" value={form.power} onChange={(e) => set("power", e.target.value)} placeholder="255" className={inputCls} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-neutral-400">Exterior color</span>
            <select value={form.exteriorColor} onChange={(e) => set("exteriorColor", e.target.value)} className={selectCls}><option value="">Select</option>{EXTERIOR_COLORS.map(c => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="block"><span className="text-xs text-neutral-400">Interior color</span>
            <select value={form.interiorColor} onChange={(e) => set("interiorColor", e.target.value)} className={selectCls}><option value="">Select</option>{INTERIOR_COLORS.map(c => <option key={c}>{c}</option>)}</select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block"><span className="text-xs text-neutral-400">Seats</span>
            <select value={form.seats} onChange={(e) => set("seats", e.target.value)} className={selectCls}><option value="">—</option>{SEAT_OPTIONS.map(s => <option key={s}>{s}</option>)}</select>
          </label>
          <label className="block"><span className="text-xs text-neutral-400">Doors</span>
            <select value={form.doors} onChange={(e) => set("doors", e.target.value)} className={selectCls}><option value="">—</option>{DOOR_OPTIONS.map(d => <option key={d}>{d}</option>)}</select>
          </label>
          <label className="block"><span className="text-xs text-neutral-400">MPG</span><input type="number" value={form.mpg} onChange={(e) => set("mpg", e.target.value)} placeholder="32" className={inputCls} /></label>
        </div>
        <div className="pt-2 border-t border-neutral-900">
          <h3 className="text-white font-semibold mb-2">Features</h3>
          <div className="flex gap-2 flex-wrap">
            {FEATURE_LIST.map(f => <button key={f} onClick={() => toggleFeature(f)} className={chipCls(form.features.includes(f))}>{f}</button>)}
          </div>
        </div>
        <div className="pt-2 border-t border-neutral-900"><h3 className="text-white font-semibold">Vehicle status</h3></div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-neutral-400">Duty status</span>
            <select value={form.dutyStatus} onChange={(e) => set("dutyStatus", e.target.value)} className={selectCls}>{DUTY_STATUS.map(d => <option key={d}>{d}</option>)}</select>
          </label>
          <label className="block"><span className="text-xs text-neutral-400">Plate code</span>
            <select value={form.plateCode} onChange={(e) => set("plateCode", e.target.value)} className={selectCls}>
              <option value="">Select</option>{platesOf(form.country).map(p => <option key={p.code} value={p.code}>{p.code} · {p.region}</option>)}
            </select>
          </label>
        </div>
        <div className="flex items-center justify-between p-4 rounded-xl bg-neutral-900 border border-neutral-800 mt-2">
          <div className="flex-1 pr-4">
            <div className="text-white font-medium text-sm">Financing available</div>
            <div className="text-neutral-500 text-xs mt-0.5">Enable if you offer payment plans</div>
          </div>
          <button type="button" onClick={() => set("financingAvailable", !form.financingAvailable)}
            className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${form.financingAvailable ? "bg-emerald-600" : "bg-neutral-700"}`}>
            <div className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition-transform ${form.financingAvailable ? "translate-x-5" : ""}`} />
          </button>
        </div>
        <label className="block"><span className="text-xs text-neutral-400">Description</span>
          <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={4}
            placeholder="Tell buyers about your car..."
            className="mt-1.5 w-full rounded-xl bg-neutral-900 border border-neutral-800 p-4 text-white text-sm outline-none focus:border-emerald-500 resize-none" />
        </label>
        {err && <div className="p-3 rounded-xl bg-red-900/30 border border-red-900 text-red-300 text-sm">{err}</div>}
        <button onClick={submit} disabled={posting} className="w-full h-14 rounded-full bg-emerald-700 text-white font-semibold mt-2 disabled:opacity-50">
          {posting ? "Posting…" : "Post listing"}
        </button>
        <p className="text-center text-xs text-neutral-500">Posted as {currentProfile?.business_name || currentProfile?.name || "you"}.</p>
      </div>
    </div>
  );
}

/* =========================================================================
   SCREEN: SAVED
   ========================================================================= */

function SavedScreen({ listings, savedIds, onOpen, onToggleSave, currentUserId, onSignIn }) {
  if (!currentUserId) return <AuthGate message="Sign in to save vehicles you're interested in." onSignIn={onSignIn} />;
  const saved = listings.filter(l => savedIds.includes(l.id));
  return (
    <div className="pb-28">
      <div className="px-5 pt-5 pb-3"><h1 className="text-white text-2xl font-bold">Saved</h1></div>
      {saved.length === 0 ? (
        <div className="mt-16 text-center px-8">
          <Heart className="w-12 h-12 text-neutral-700 mx-auto" />
          <p className="text-neutral-400 mt-3">No saved cars yet.</p>
          <p className="text-neutral-600 text-sm mt-1">Tap the heart on any listing to save it here.</p>
        </div>
      ) : (
        <div className="px-4 space-y-4">
          {saved.map(l => <ListingCard key={l.id} listing={l} onOpen={onOpen} saved onToggleSave={onToggleSave} />)}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   SCREEN: AT DEALER
   ========================================================================= */

function getDealersFromListings(listings) {
  const map = new Map();
  for (const l of listings) {
    if (!l.dealer) continue;
    const key = l.sellerName;
    if (!map.has(key)) map.set(key, { name: key, location: l.location, listings: [] });
    map.get(key).listings.push(l);
  }
  return Array.from(map.values()).filter(d => d.listings.length >= 1).sort((a, b) => b.listings.length - a.listings.length);
}

function AtDealerScreen({ listings, onOpenListing, onToggleSave, savedIds }) {
  const dealers = useMemo(() => getDealersFromListings(listings), [listings]);
  const [activeDealer, setActiveDealer] = useState(null);

  if (activeDealer) {
    const dealer = dealers.find(d => d.name === activeDealer);
    if (!dealer) { setActiveDealer(null); return null; }
    return (
      <div className="pb-28">
        <div className="px-5 pt-5 pb-3 flex items-center gap-3">
          <button onClick={() => setActiveDealer(null)} className="w-10 h-10 rounded-full border border-neutral-700 flex items-center justify-center"><ChevronLeft className="w-5 h-5 text-white" /></button>
          <div className="flex-1 min-w-0">
            <h1 className="text-white text-xl font-bold truncate">{dealer.name}</h1>
            <div className="text-neutral-400 text-xs flex items-center gap-1"><MapPin className="w-3 h-3" />{dealer.location} · {dealer.listings.length} listings</div>
          </div>
          <Shield className="w-5 h-5 text-emerald-400" />
        </div>
        <div className="px-4 space-y-4">
          {dealer.listings.map(l => <ListingCard key={l.id} listing={l} onOpen={onOpenListing} saved={savedIds.includes(l.id)} onToggleSave={onToggleSave} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="pb-28">
      <div className="px-5 pt-5 pb-3">
        <h1 className="text-white text-2xl font-bold">At Dealer</h1>
        <p className="text-neutral-400 text-sm mt-1">{dealers.length} dealers</p>
      </div>
      {dealers.length === 0 ? (
        <div className="mt-16 text-center px-8">
          <Store className="w-12 h-12 text-neutral-700 mx-auto" />
          <p className="text-neutral-400 mt-3">No dealers yet.</p>
        </div>
      ) : (
        <div className="px-4 space-y-4">
          {dealers.map(d => (
            <button key={d.name} onClick={() => setActiveDealer(d.name)} className="w-full bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden text-left active:scale-[0.99] transition">
              <div className="p-4 flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-emerald-700/20 border border-emerald-500/40 flex items-center justify-center"><Store className="w-6 h-6 text-emerald-400" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><div className="text-white font-semibold truncate">{d.name}</div><Shield className="w-4 h-4 text-emerald-400 shrink-0" /></div>
                  <div className="text-neutral-400 text-xs flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" />{d.location} · {d.listings.length} listings</div>
                </div>
                <ChevronRight className="w-5 h-5 text-neutral-500" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   SCREEN: MESSAGES
   ========================================================================= */

function MessagesScreen({ threads, currentUserId, onOpenThread, onSignIn, listings }) {
  if (!currentUserId) return <AuthGate message="Sign in to message buyers and sellers." onSignIn={onSignIn} />;
  return (
    <div className="pb-28">
      <div className="px-5 pt-5 pb-3"><h1 className="text-white text-2xl font-bold">Messages</h1></div>
      {threads.length === 0 ? (
        <div className="mt-16 text-center px-8">
          <MessageCircle className="w-12 h-12 text-neutral-700 mx-auto" />
          <p className="text-neutral-400 mt-3">No conversations yet.</p>
          <p className="text-neutral-600 text-sm mt-1">Tap "Message seller" on any listing to start one.</p>
        </div>
      ) : (
        <div>
          {threads.map(t => {
            const other = currentUserId === t.buyerId ? t.sellerName : t.buyerName;
            const last = t.messages[t.messages.length - 1];
            const listing = listings.find(l => l.id === t.listingId);
            return (
              <button key={t.id} onClick={() => onOpenThread(t.id)} className="w-full px-5 py-4 border-b border-neutral-900 active:bg-neutral-900 flex items-center gap-3 text-left">
                <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center shrink-0"><UserCircle2 className="w-7 h-7 text-neutral-400" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-white font-medium truncate">{other}</div>
                    <div className="text-neutral-500 text-xs shrink-0 ml-2">{new Date(t.updatedAt).toLocaleDateString()}</div>
                  </div>
                  {listing && <div className="text-emerald-400 text-xs truncate">{listing.year} {listing.make} {listing.model}</div>}
                  <div className="text-neutral-400 text-sm truncate mt-0.5">{last ? last.text : "(no messages)"}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ThreadScreen({ thread, currentUserId, onBack, onSend, listing }) {
  const [text, setText] = useState("");
  const scrollRef = useRef(null);
  const other = currentUserId === thread.buyerId ? thread.sellerName : thread.buyerName;

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [thread.messages.length]);

  const send = () => {
    const v = text.trim();
    if (!v) return;
    onSend(thread.id, v);
    setText("");
  };

  return (
    <div className="pb-28 flex flex-col h-screen">
      <div className="px-5 pt-5 pb-3 flex items-center gap-3 border-b border-neutral-900 shrink-0">
        <button onClick={onBack} className="w-10 h-10 rounded-full border border-neutral-700 flex items-center justify-center"><ChevronLeft className="w-5 h-5 text-white" /></button>
        <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center"><UserCircle2 className="w-6 h-6 text-neutral-300" /></div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-semibold truncate">{other}</div>
          {listing && <div className="text-emerald-400 text-xs truncate">{listing.year} {listing.make} {listing.model}</div>}
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {thread.messages.map((m) => {
          const mine = m.from === currentUserId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-sm ${mine ? "bg-emerald-700 text-white rounded-br-md" : "bg-neutral-800 text-white rounded-bl-md"}`}>{m.text}</div>
            </div>
          );
        })}
      </div>
      <div className="px-3 pb-24 pt-2 border-t border-neutral-900 shrink-0 bg-neutral-950">
        <div className="flex items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Type a message..."
            className="flex-1 h-12 rounded-full bg-neutral-900 border border-neutral-800 px-5 text-white text-sm outline-none focus:border-emerald-500" />
          <button onClick={send} className="w-12 h-12 rounded-full bg-emerald-700 text-white flex items-center justify-center"><Send className="w-5 h-5" /></button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   SCREEN: MORE / PROFILE
   ========================================================================= */

const LEGAL_TEXT = {
  terms: "TERMS OF SERVICE\n\nBy using this app, you agree to these terms. This platform connects buyers and sellers of vehicles. We are a listings platform only.",
  privacy: "PRIVACY POLICY\n\nWe collect: your name, email, phone number, and listings you post. We use this information to operate the marketplace.",
  disclaimer: "DISCLAIMER\n\nThis platform is a listings service only. We do not own, inspect, or sell any vehicles. All transactions occur directly between buyers and sellers at their own risk.",
};

function MoreScreen({ currentUserId, currentProfile, onSignIn, onSignOut, myListings, onOpenListing, onProfileUpdated }) {
  const [legalView, setLegalView] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editBusiness, setEditBusiness] = useState("");
  const [editTelegram, setEditTelegram] = useState("");
  const [wantSeller, setWantSeller] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const startEdit = () => {
    setEditName(currentProfile?.name || "");
    setEditPhone(currentProfile?.phone || "");
    setEditBusiness(currentProfile?.business_name || "");
    setEditTelegram(currentProfile?.telegram || "");
    setWantSeller(currentProfile?.role === "seller");
    setEditing(true);
    setSaveMsg("");
  };

  const saveProfile = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      await apiUpdateProfile({
        name: editName.trim(),
        phone: editPhone.trim(),
        businessName: editBusiness.trim() || null,
        telegram: editTelegram.trim() || null,
        role: wantSeller ? "seller" : "buyer",
      });
      setSaveMsg("Profile updated!");
      setEditing(false);
      if (onProfileUpdated) onProfileUpdated();
    } catch (e) {
      setSaveMsg("Error: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const Row = ({ icon: Icon, label, onClick }) => (
    <button onClick={onClick} className="w-full flex items-center gap-4 px-5 py-4 border-b border-neutral-900 active:bg-neutral-900">
      <Icon className="w-5 h-5 text-white" />
      <span className="flex-1 text-left text-white text-[15px]">{label}</span>
      <ChevronRight className="w-5 h-5 text-neutral-500" />
    </button>
  );

  const inputCls = "w-full h-11 bg-neutral-900 border border-neutral-800 rounded-xl px-4 text-white text-sm outline-none focus:border-emerald-500";

  return (
    <div className="pb-28">
      <div className="pt-5 pb-4 text-center text-white text-[17px]">Profile &amp; more</div>
      {currentUserId ? (
        <>
          <div className="mx-4 mb-4 p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-700/20 border border-emerald-500/40 flex items-center justify-center">
                <UserCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-semibold truncate">{currentProfile?.business_name || currentProfile?.name || "Account"}</div>
                <div className="text-neutral-400 text-xs truncate">{currentProfile?.email} · {currentProfile?.role === "seller" ? "Seller" : "Buyer"}</div>
                {currentProfile?.phone && <div className="text-neutral-500 text-xs truncate mt-0.5">{currentProfile.phone}</div>}
                {currentProfile?.telegram && <div className="text-neutral-500 text-xs truncate">Telegram: {currentProfile.telegram}</div>}
              </div>
              <button onClick={onSignOut} className="w-9 h-9 rounded-full border border-neutral-700 flex items-center justify-center">
                <LogOut className="w-4 h-4 text-neutral-300" />
              </button>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={startEdit} className="flex-1 h-10 rounded-xl bg-emerald-700 text-white text-sm font-medium">
                Edit profile
              </button>
            </div>
            {saveMsg && (
              <div className={`mt-2 text-sm px-3 py-2 rounded-lg ${saveMsg.startsWith("Error") ? "text-red-400 bg-red-500/10" : "text-emerald-400 bg-emerald-500/10"}`}>
                {saveMsg}
              </div>
            )}
          </div>

          {editing && (
            <div className="mx-4 mb-4 p-4 rounded-2xl bg-neutral-900 border border-emerald-500/30 space-y-3">
              <h3 className="text-white font-semibold text-[15px]">Edit your profile</h3>
              <div>
                <label className="text-xs text-neutral-400 mb-1 block">Name</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} placeholder="Your name" />
              </div>
              <div>
                <label className="text-xs text-neutral-400 mb-1 block">Phone</label>
                <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className={inputCls} placeholder="+251 91 234 5678" />
              </div>
              <div>
                <label className="text-xs text-neutral-400 mb-1 block">Telegram username</label>
                <input type="text" value={editTelegram} onChange={(e) => setEditTelegram(e.target.value)} className={inputCls} placeholder="@yourname" />
              </div>
              <div>
                <label className="text-xs text-neutral-400 mb-1 block">Business name (for dealers)</label>
                <input type="text" value={editBusiness} onChange={(e) => setEditBusiness(e.target.value)} className={inputCls} placeholder="Optional — shown on listings" />
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-neutral-950 border border-neutral-800">
                <div>
                  <div className="text-white text-sm font-medium">I'm a seller / dealer</div>
                  <div className="text-neutral-500 text-xs mt-0.5">Enable to post listings as a dealer</div>
                </div>
                <button type="button" onClick={() => setWantSeller(!wantSeller)}
                  className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${wantSeller ? "bg-emerald-600" : "bg-neutral-700"}`}>
                  <div className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition-transform ${wantSeller ? "translate-x-5" : ""}`} />
                </button>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditing(false)} className="flex-1 h-11 rounded-xl border border-neutral-700 text-neutral-300 text-sm font-medium">Cancel</button>
                <button onClick={saveProfile} disabled={saving} className="flex-1 h-11 rounded-xl bg-emerald-700 text-white text-sm font-medium disabled:opacity-50">
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <Row icon={UserCircle2} label="Sign in / Register" onClick={onSignIn} />
      )}
      {currentUserId && myListings.length > 0 && (
        <div className="mb-3">
          <div className="px-5 py-2 text-xs tracking-wider text-neutral-500 uppercase bg-neutral-900/40">My listings</div>
          {myListings.map(l => (
            <button key={l.id} onClick={() => onOpenListing(l)} className="w-full flex items-center gap-3 px-5 py-3 border-b border-neutral-900 active:bg-neutral-900">
              <CarPhoto seed={l.imageSeed || 1} src={getMainPhoto(l)} className="w-16 h-12 rounded-md" />
              <div className="flex-1 text-left min-w-0">
                <div className="text-white text-sm font-medium truncate">{l.year} {l.make} {l.model}</div>
                <div className="text-neutral-400 text-xs">{formatMoney(l.price, l.currency)}</div>
              </div>
              <ChevronRight className="w-5 h-5 text-neutral-500" />
            </button>
          ))}
        </div>
      )}
      <div className="border-t border-neutral-900" />
      <Row icon={FileText} label="Terms of Service" onClick={() => setLegalView("terms")} />
      <Row icon={FileText} label="Privacy Policy" onClick={() => setLegalView("privacy")} />
      <Row icon={FileText} label="Disclaimer" onClick={() => setLegalView("disclaimer")} />
      {legalView && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end" onClick={() => setLegalView(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md mx-auto bg-neutral-950 border-t border-neutral-800 rounded-t-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-neutral-900 shrink-0">
              <h3 className="text-white font-semibold text-[16px]">{legalView.charAt(0).toUpperCase() + legalView.slice(1)}</h3>
              <button onClick={() => setLegalView(null)} className="w-9 h-9 rounded-full flex items-center justify-center"><X className="w-5 h-5 text-white" /></button>
            </div>
            <div className="overflow-y-auto p-5 pb-16 text-neutral-300 text-sm whitespace-pre-wrap leading-relaxed">{LEGAL_TEXT[legalView]}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function BottomNav({ tab, setTab, unreadCount }) {
  const items = [
    { key: "shop", label: "Shop", Icon: Car },
    { key: "saved", label: "Saved", Icon: Heart },
    { key: "dealer", label: "At Dealer", Icon: Store },
    { key: "messages", label: "Messages", Icon: MessageCircle, badge: unreadCount },
    { key: "sell", label: "Sell", Icon: Tag },
    { key: "more", label: "More", Icon: Menu },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-neutral-950 border-t border-neutral-900 z-30">
      <div className="grid grid-cols-6">
        {items.map(({ key, label, Icon, badge }) => {
          const active = tab === key;
          return (
            <button key={key} onClick={() => setTab(key)} className="flex flex-col items-center justify-center h-16 relative">
              {active && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 bg-emerald-500 rounded-full" />}
              <div className="relative">
                <Icon className={`w-5 h-5 ${active ? "text-emerald-400" : "text-neutral-400"}`} strokeWidth={active ? 2.2 : 1.8} />
                {badge > 0 && <div className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{badge}</div>}
              </div>
              <span className={`mt-0.5 text-[10px] ${active ? "text-emerald-400" : "text-neutral-400"}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* =========================================================================
   ROOT APP
   ========================================================================= */

export default function App() {
  const [tab, setTab] = useState("shop");
  const [view, setView] = useState("shop");
  const [browseTab, setBrowseTab] = useState("make");
  const [selectedMake, setSelectedMake] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [selectedListing, setSelectedListing] = useState(null);
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({});
  const [sortMode, setSortMode] = useState("best_match");
  const [filterOpenSection, setFilterOpenSection] = useState(null);

  const [listings, setListings] = useState([]);
  const [savedIds, setSavedIds] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [threads, setThreads] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [signInGateOpen, setSignInGateOpen] = useState(false);
  const [signInGateAction, setSignInGateAction] = useState("");

  // Initial load + auth listener
  useEffect(() => {
    (async () => {
      const uid = await getCurrentUserId();
      const [ls, sv, prof, th] = await Promise.all([
        loadListings(),
        loadSavedIds(),
        uid ? getCurrentProfile() : Promise.resolve(null),
        uid ? loadThreadsForUser(uid) : Promise.resolve([]),
      ]);
      setListings(ls);
      setSavedIds(sv);
      setCurrentUserId(uid);
      setCurrentProfile(prof);
      setThreads(th);
      setLoaded(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async () => {
      const uid = await getCurrentUserId();
      setCurrentUserId(uid);
      setCurrentProfile(uid ? await getCurrentProfile() : null);
      setSavedIds(await loadSavedIds());
      setThreads(uid ? await loadThreadsForUser(uid) : []);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Realtime: refresh threads when messages or threads change
  useEffect(() => {
    if (!currentUserId) return;

    const refresh = async () => {
      setThreads(await loadThreadsForUser(currentUserId));
    };

    const channel = supabase
      .channel("realtime-messaging")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        refresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "threads" },
        refresh
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);
  
  const requireAuth = () => {
    if (currentUserId) return true;
    setSignInGateAction("continue");
    setSignInGateOpen(true);
    return false;
  };

  const toggleSave = async (id) => {
    if (!currentUserId) {
      setSignInGateAction("save listings");
      setSignInGateOpen(true);
      return;
    }
    const wasSaved = savedIds.includes(id);
    try {
      await apiToggleSaved(id, wasSaved);
      setSavedIds(prev => wasSaved ? prev.filter(x => x !== id) : [...prev, id]);
    } catch (e) {
      alert("Could not save: " + e.message);
    }
  };

  const openDetail = (l) => { setSelectedListing(l); setView("detail"); };

  const createListing = async (l) => {
    const saved = await apiCreateListing(l);
    setListings(prev => [saved, ...prev]);
    setSelectedListing(saved);
    setView("detail");
  };

  const deleteListing = async (id) => {
    try {
      await apiDeleteListing(id);
      setListings(prev => prev.filter(l => l.id !== id));
      setView("shop"); setTab("shop");
    } catch (e) {
      alert("Could not delete: " + e.message);
    }
  };

  const goToResults = (q, f = {}) => {
    setQuery(q || "");
    setFilters(f);
    setView("results");
  };

  const onSignOut = async () => {
    await apiSignOut();
    setCurrentUserId(null);
    setCurrentProfile(null);
    setSavedIds([]);
    setThreads([]);
    setTab("shop");
    setView("shop");
  };

  const startMessageSeller = async (listing) => {
    if (!currentUserId) {
      setSignInGateAction("contact sellers");
      setSignInGateOpen(true);
      return;
    }
    if (currentUserId === listing.sellerId) return;
    try {
      const threadId = await startThread(listing, currentUserId, currentProfile);
      setThreads(await loadThreadsForUser(currentUserId));
      setSelectedThreadId(threadId);
      setTab("messages");
      setView("thread");
    } catch (e) {
      alert("Could not start conversation: " + e.message);
    }
  };

  const sendMessage = async (threadId, text) => {
    try {
      await sendMessageToThread(threadId, currentUserId, text);
      setThreads(await loadThreadsForUser(currentUserId));
    } catch (e) {
      alert("Send failed: " + e.message);
    }
  };

  const onTabChange = (t) => {
    if ((t === "sell" || t === "saved" || t === "messages") && !currentUserId) {
      setSignInGateAction(t === "sell" ? "post a listing" : t === "saved" ? "save listings" : "see your messages");
      setSignInGateOpen(true);
      return;
    }
    setTab(t);
    if (t === "shop") { setView("shop"); setQuery(""); setFilters({}); }
    else setView(t);
  };

  const myListings = useMemo(
    () => listings.filter(l => currentUserId && l.sellerId === currentUserId),
    [listings, currentUserId]
  );

  const filteredCount = useMemo(
    () => listings.filter(l => matchesFilter(l, filters, query)).length,
    [listings, query, filters]
  );

  const unreadCount = useMemo(
    () => threads.filter(t => (t.unreadFor || []).includes(currentUserId)).length,
    [threads, currentUserId]
  );

  if (!loaded) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-neutral-400 text-sm">Loading…</div>
      </div>
    );
  }

  const activeThread = threads.find(t => t.id === selectedThreadId);
  const activeThreadListing = activeThread ? listings.find(l => l.id === activeThread.listingId) : null;

  return (
    <div className="min-h-screen bg-neutral-950 flex justify-center" style={{ fontFamily: "'Helvetica Neue', -apple-system, system-ui, sans-serif" }}>
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { scrollbar-width: none; }
        .range-input { pointer-events: none; }
        .range-input::-webkit-slider-thumb { pointer-events: auto; -webkit-appearance: none; appearance: none; width: 22px; height: 22px; border-radius: 9999px; background: #ffffff; border: 2px solid #10b981; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
        .range-input::-moz-range-thumb { pointer-events: auto; appearance: none; width: 22px; height: 22px; border-radius: 9999px; background: #ffffff; border: 2px solid #10b981; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
        .range-input::-webkit-slider-runnable-track { background: transparent; border: none; }
        .range-input::-moz-range-track { background: transparent; border: none; }
      `}</style>
      <div className="relative w-full max-w-md bg-neutral-950 min-h-screen text-white">
        {view === "shop" && (
          <ShopScreen
            onSearchMakes={() => { setBrowseTab("make"); setView("browse"); }}
            onSearchBodyStyles={() => { setBrowseTab("body"); setView("browse"); }}
            onQuickSearch={(q) => goToResults(q)}
            onApplyLocation={(loc) => goToResults("", loc)}
          />
        )}
        {view === "browse" && (
          <BrowseScreen initialTab={browseTab} onBack={() => setView("shop")}
            onPickMake={(m) => { if (m) { setSelectedMake(m); setView("models"); } else { goToResults("", {}); } }}
            onPickBodyStyle={(b) => goToResults("", { bodyStyle: b })} />
        )}
        {view === "models" && (
          <ModelsScreen make={selectedMake} onBack={() => setView("browse")}
            onPickModel={(m) => {
              if (!m) { goToResults("", { make: selectedMake }); return; }
              if (TRIMS_BY_MODEL[`${selectedMake}|${m}`]) { setSelectedModel(m); setView("trims"); }
              else goToResults("", { make: selectedMake, model: m });
            }} />
        )}
        {view === "trims" && (
          <TrimsScreen make={selectedMake} model={selectedModel} onBack={() => setView("models")}
            onPickTrim={(t) => goToResults("", { make: selectedMake, model: selectedModel, trim: t || undefined })} />
        )}
        {view === "results" && (
          <ResultsScreen listings={listings} query={query} filters={filters} setFilters={setFilters}
            sortMode={sortMode} setSortMode={setSortMode} savedIds={savedIds}
            onBack={() => setView("shop")} onOpen={openDetail} onToggleSave={toggleSave}
            onOpenFilters={(section) => { setFilterOpenSection(section || null); setView("filters"); }}
            onClearQuery={() => { setQuery(""); setFilters({}); }}
            onSearchSubmit={(q) => setQuery(q || "")} />
        )}
        {view === "filters" && (
          <FiltersScreen filters={filters} setFilters={setFilters}
            onClose={() => setView("results")} onReset={() => setFilters({})}
            resultCount={filteredCount} activeCount={countActiveFilters(filters)}
            initialOpenSection={filterOpenSection} />
        )}
        {view === "detail" && selectedListing && (
          <DetailScreen listing={selectedListing} saved={savedIds.includes(selectedListing.id)}
            onToggleSave={toggleSave} currentUserId={currentUserId} requireAuth={requireAuth}
            onBack={() => setView(tab === "saved" ? "saved" : tab === "more" ? "more" : tab === "dealer" ? "dealer" : "results")}
            onDelete={selectedListing.sellerId === currentUserId ? deleteListing : null}
            onMessageSeller={startMessageSeller} />
        )}
        {view === "sell" && (
          <SellScreen onCreate={createListing} currentUserId={currentUserId}
            currentProfile={currentProfile}
            onSignIn={() => { setAuthMode("signin"); setAuthModalOpen(true); }} />
        )}
        {view === "saved" && (
          <SavedScreen listings={listings} savedIds={savedIds} onOpen={openDetail}
            onToggleSave={toggleSave} currentUserId={currentUserId}
            onSignIn={() => { setAuthMode("signin"); setAuthModalOpen(true); }} />
        )}
        {view === "dealer" && (
          <AtDealerScreen listings={listings} onOpenListing={openDetail}
            onToggleSave={toggleSave} savedIds={savedIds} />
        )}
        {view === "messages" && (
          <MessagesScreen threads={threads} currentUserId={currentUserId} listings={listings}
            onSignIn={() => { setAuthMode("signin"); setAuthModalOpen(true); }}
            onOpenThread={async (id) => {
              setSelectedThreadId(id);
              setView("thread");
              await markThreadRead(id, currentUserId);
              setThreads(await loadThreadsForUser(currentUserId));
            }} />
        )}
        {view === "thread" && activeThread && currentUserId && (
          <ThreadScreen thread={activeThread} currentUserId={currentUserId}
            listing={activeThreadListing} onBack={() => setView("messages")} onSend={sendMessage} />
        )}
{view === "more" && (
  <MoreScreen currentUserId={currentUserId} currentProfile={currentProfile}
    onSignIn={() => { setAuthMode("signin"); setAuthModalOpen(true); }}
    onSignOut={onSignOut} myListings={myListings} onOpenListing={openDetail}
    onProfileUpdated={async () => { setCurrentProfile(await getCurrentProfile()); }} />
)}

        <AuthModal open={authModalOpen} mode={authMode} setMode={setAuthMode}
          onClose={() => setAuthModalOpen(false)} onSuccess={() => {}} />
        <SignInGate open={signInGateOpen} action={signInGateAction}
          onClose={() => setSignInGateOpen(false)}
          onSignIn={() => { setSignInGateOpen(false); setAuthMode("signin"); setAuthModalOpen(true); }}
          onSignUp={() => { setSignInGateOpen(false); setAuthMode("signup"); setAuthModalOpen(true); }} />

        <BottomNav tab={tab} setTab={onTabChange} unreadCount={unreadCount} />
      </div>
    </div>
  );
}
