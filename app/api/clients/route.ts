import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, created_at, api_key, sending_domain")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mask the API key for the response
  const masked = data.map((c) => ({
    ...c,
    api_key_masked: `${c.api_key.slice(0, 6)}${"•".repeat(20)}`,
  }));

  return NextResponse.json(masked);
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { name, api_key, sending_domain } = await req.json();

  if (!name?.trim() || !api_key?.trim()) {
    return NextResponse.json({ error: "Name and API key are required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({ name: name.trim(), api_key: api_key.trim(), sending_domain: sending_domain?.trim() || null })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const body = await req.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  // Only update the fields that were sent
  const update: Record<string, string | null> = {};
  if ("sending_domain" in body) update.sending_domain = body.sending_domain?.trim() || null;
  if ("last_audit_at" in body) {
    const v = body.last_audit_at;
    if (v !== null && (typeof v !== "string" || isNaN(Date.parse(v)))) {
      return NextResponse.json({ error: "last_audit_at must be a date or null" }, { status: 400 });
    }
    update.last_audit_at = v;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("clients")
    .update(update)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { id } = await req.json();

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("clients").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
