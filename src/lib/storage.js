import { supabase } from './supabase';

const uid = () => supabase.auth.getUser().then(r => r.data.user?.id);

/* ---------- LISTINGS ---------- */

export async function loadListings() {
  const { data, error } = await supabase
    .from('listings')
    .select('*, seller:profiles!seller_id(id, name, phone, email, business_name, role)')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) { console.error('loadListings:', error); return []; }
  return data.map(rowToListing);
}

export async function createListing(listing) {
  const sellerId = await uid();
  if (!sellerId) throw new Error('You must be signed in to post a listing.');
  const { data, error } = await supabase
    .from('listings')
    .insert(listingToRow(listing, sellerId))
    .select('*, seller:profiles!seller_id(id, name, phone, email, business_name, role)')
    .single();
  if (error) throw error;
  return rowToListing(data);
}

export async function deleteListing(id) {
  const { error } = await supabase.from('listings').delete().eq('id', id);
  if (error) throw error;
}

/* ---------- SAVED LISTINGS ---------- */

export async function loadSavedIds() {
  const userId = await uid();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('saved_listings')
    .select('listing_id')
    .eq('user_id', userId);
  if (error) { console.error('loadSavedIds:', error); return []; }
  return (data || []).map(r => r.listing_id);
}

export async function toggleSaved(listingId, currentlySaved) {
  const userId = await uid();
  if (!userId) throw new Error('You must be signed in to save listings.');
  if (currentlySaved) {
    const { error } = await supabase
      .from('saved_listings')
      .delete()
      .eq('user_id', userId)
      .eq('listing_id', listingId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('saved_listings')
      .insert({ user_id: userId, listing_id: listingId });
    if (error) throw error;
  }
}

/* ---------- PHOTO UPLOAD ---------- */

export async function uploadPhoto(file) {
  const userId = await uid();
  if (!userId) throw new Error('You must be signed in to upload photos.');
  const ext = file.name.split('.').pop();
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('listing-photos')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('listing-photos').getPublicUrl(path);
  return data.publicUrl;
}

/* ---------- AUTH ---------- */

export async function getCurrentUserId() {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signUpWithEmail(email, password, profileData = {}) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;

  if (data.user) {
    // Create profile row. Role must be 'buyer' or 'seller' per DB constraint.
    const { error: profileError } = await supabase.from('profiles').insert({
      id: data.user.id,
      email,
      name: profileData.name?.trim() || email.split('@')[0],
      phone: profileData.phone || null,
      role: 'buyer', // everyone starts as buyer; can upgrade later
    });
    if (profileError) {
      console.error('Profile creation failed:', profileError);
      // Don't throw — auth user is created, profile can be retried
    }
  }
  return data.user;
}

export async function signOut() {
  await supabase.auth.signOut();
}
export async function upgradeToSeller(profileUpdates = {}) {
  const userId = await uid();
  if (!userId) throw new Error('You must be signed in.');
  const { error } = await supabase
    .from('profiles')
    .update({
      role: 'seller',
      name: profileUpdates.name,
      phone: profileUpdates.phone,
      business_name: profileUpdates.businessName ?? null,
    })
    .eq('id', userId);
  if (error) throw error;
}

export async function getCurrentProfile() {
  const userId = await uid();
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) { console.error('getCurrentProfile:', error); return null; }
  return data;
}

/* ---------- MAPPERS ---------- */

function rowToListing(r) {
  const seller = r.seller || {};
  const photos = Array.isArray(r.photos) ? r.photos : [];
  return {
    id: r.id,
    year: r.year,
    make: r.make,
    model: r.model,
    trim: r.trim,
    bodyStyle: r.body_style,
    fuelType: r.fuel_type,
    drivetrain: r.drivetrain,
    transmission: r.transmission,
    engine: r.engine,
    power: r.power,
    mileage: r.mileage,
    price: r.price,
    currency: r.currency,
    exteriorColor: r.exterior_color,
    interiorColor: r.interior_color,
    seats: r.seats,
    doors: r.doors,
    mpg: r.mpg,
    country: r.country,
    region: r.region,
    city: r.city,
    area: r.area,
    location: r.location,
    landmark: r.landmark,
    gpsLat: r.gps_lat,
    gpsLng: r.gps_lng,
    plateCode: r.plate_code,
    dutyStatus: r.duty_status,
    description: r.description,
    features: r.features || [],
    photos,
    photoUrl: photos[0] || null, // first photo as main
    financingAvailable: r.financing_available,
    condition: r.condition,
    status: r.status,
    createdAt: new Date(r.created_at).getTime(),
    sellerId: r.seller_id,
    userId: r.seller_id, // alias for existing component code
    sellerName: seller.business_name || seller.name || 'Seller',
    sellerPhone: seller.phone || '',
    sellerEmail: seller.email || '',
    dealer: seller.role === 'dealer',
  };
}

function listingToRow(l, sellerId) {
  const photos = l.photos ?? (l.photoUrl ? [l.photoUrl] : []);
  return {
    seller_id: sellerId,
    year: l.year,
    make: l.make,
    model: l.model,
    trim: l.trim ?? null,
    body_style: l.bodyStyle ?? null,
    fuel_type: l.fuelType ?? null,
    drivetrain: l.drivetrain ?? null,
    transmission: l.transmission ?? null,
    engine: l.engine ?? null,
    power: l.power ?? null,
    mileage: l.mileage,
    price: l.price,
    currency: l.currency ?? 'USD',
    exterior_color: l.exteriorColor ?? null,
    interior_color: l.interiorColor ?? null,
    seats: l.seats ?? null,
    doors: l.doors ?? null,
    mpg: l.mpg ?? null,
    country: l.country ?? null,
    region: l.region ?? null,
    city: l.city ?? null,
    area: l.area ?? null,
    location: l.location ?? null,
    landmark: l.landmark ?? null,
    gps_lat: l.gpsLat ?? null,
    gps_lng: l.gpsLng ?? null,
    plate_code: l.plateCode ?? null,
    duty_status: l.dutyStatus ?? null,
    description: l.description ?? '',
    features: l.features ?? [],
    photos,
    financing_available: l.financingAvailable ?? false,
    condition: l.condition ?? 'used',
    status: l.status ?? 'active',
  };
}
export async function updateProfile(updates) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not signed in");
  const snakeUpdates = {};
  if (updates.name !== undefined) snakeUpdates.name = updates.name;
  if (updates.phone !== undefined) snakeUpdates.phone = updates.phone;
  if (updates.businessName !== undefined) snakeUpdates.business_name = updates.businessName;
  if (updates.role !== undefined) snakeUpdates.role = updates.role;
  if (updates.telegram !== undefined) snakeUpdates.telegram = updates.telegram;
  snakeUpdates.updated_at = new Date().toISOString();
  const { error } = await supabase.from("profiles").update(snakeUpdates).eq("id", userId);
  if (error) throw error;
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw error;
}