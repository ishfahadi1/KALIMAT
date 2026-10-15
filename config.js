// The ONLY place with project settings. Fill these in after creating the KALIMAT Supabase project and Cloudinary preset.
// The Supabase anon/publishable key and the Cloudinary unsigned preset are safe to ship in the browser.
window.KCFG = {
  SUPABASE_URL: "",            // https://<project-ref>.supabase.co
  SUPABASE_ANON_KEY: "",       // publishable key
  CLOUDINARY_CLOUD_NAME: "",
  CLOUDINARY_UPLOAD_PRESET: "",// an UNSIGNED preset
  SHOP_ID: "",                 // letters, digits, dashes only (no dots), same value you use in shop_admins
  ORDER_PREFIX: ""             // e.g. "KAL" -> order numbers like #KAL-4F2A1
};
