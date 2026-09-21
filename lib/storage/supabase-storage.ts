import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const STORAGE_BUCKET_NAME = "reference-photos";
export const SUPABASE_PROJECT_REF = "hvnphwbznjelxgyxalkj";
export const DEFAULT_SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;

let supabaseClientInstance: SupabaseClient | null = null;
let bucketChecked = false;

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClientInstance) return supabaseClientInstance;

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    DEFAULT_SUPABASE_URL;

  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  supabaseClientInstance = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseClientInstance;
}

export async function ensureReferencePhotosBucket(): Promise<boolean> {
  if (bucketChecked) return true;
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { data: buckets, error: listErr } = await client.storage.listBuckets();
    if (listErr) {
      console.warn("Notice: Listing Supabase buckets:", listErr.message);
    }

    const exists = buckets?.some((b) => b.name === STORAGE_BUCKET_NAME);
    if (!exists) {
      const { error: createErr } = await client.storage.createBucket(STORAGE_BUCKET_NAME, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"],
      });
      if (createErr && !createErr.message?.includes("already exists")) {
        console.warn("Notice: Creating storage bucket:", createErr.message);
      }
    }
    bucketChecked = true;
    return true;
  } catch (err) {
    console.warn("Notice: Ensuring storage bucket:", err);
    return false;
  }
}

export interface UploadPhotoResult {
  success: boolean;
  publicUrl: string;
  storagePath: string;
  error?: string;
}

export async function uploadNodePhotoToSupabase(
  nodeId: string,
  buffer: Buffer,
  mimeType = "image/jpeg"
): Promise<UploadPhotoResult> {
  const client = getSupabaseClient();
  const safeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = mimeType.split("/")[1]?.replace("svg+xml", "svg") || "webp";
  const uniqueToken = Math.random().toString(36).substring(2, 9);
  const storagePath = `nodes/${safeId}/${Date.now()}_${uniqueToken}.${ext}`;

  if (!client) {
    return {
      success: false,
      publicUrl: "",
      storagePath,
      error: "Supabase storage client not configured",
    };
  }

  try {
    await ensureReferencePhotosBucket();

    const { error: uploadError } = await client.storage
      .from(STORAGE_BUCKET_NAME)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        cacheControl: "public, max-age=31536000, immutable",
        upsert: true,
      });

    if (uploadError) {
      console.error(`Supabase Storage upload error for node ${nodeId}:`, uploadError.message);
      return {
        success: false,
        publicUrl: "",
        storagePath: "",
        error: uploadError.message,
      };
    }

    const { data: urlData } = client.storage
      .from(STORAGE_BUCKET_NAME)
      .getPublicUrl(storagePath);

    return {
      success: true,
      publicUrl: urlData.publicUrl,
      storagePath,
    };
  } catch (err) {
    console.error(`Error uploading photo to Supabase storage for node ${nodeId}:`, err);
    return {
      success: false,
      publicUrl: "",
      storagePath: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function deleteNodePhotoFromSupabase(storagePath: string): Promise<boolean> {
  if (!storagePath) return true;
  const client = getSupabaseClient();
  if (!client) return true;

  try {
    const { error } = await client.storage.from(STORAGE_BUCKET_NAME).remove([storagePath]);
    if (error) {
      console.warn("Notice: Deleting Supabase storage object:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Notice: Supabase delete photo:", err);
    return false;
  }
}

export function extractStoragePathFromUrl(photoUrl?: string): string | null {
  if (!photoUrl) return null;
  const pattern = new RegExp(`/${STORAGE_BUCKET_NAME}/(.+)$`);
  const match = photoUrl.match(pattern);
  return match ? match[1] : null;
}
