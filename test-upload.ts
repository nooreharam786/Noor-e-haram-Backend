import { createClient } from "@supabase/supabase-js";
import { env } from "./src/config/env";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const buffer = fs.readFileSync("sample.pdf");
  
  console.log("Uploading to public-documents...");
  const { data, error } = await supabase.storage
    .from("public-documents")
    .upload("test/sample.pdf", buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    console.error("Upload error:", error);
  } else {
    console.log("Upload success:", data);
  }
}

test();
