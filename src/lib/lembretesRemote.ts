import type { HubUser, Lembrete } from "../types";
import { isSupabaseConfigured, supabase } from "./supabase";
import { normalizeLembrete, withResolvedStatus } from "./lembretes";

type LembreteRow = {
  id: string;
  titulo: string;
  descricao: string | null;
  prazo: string | null;
  prioridade: Lembrete["prioridade"];
  status: Lembrete["status"];
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  email: string;
};

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado.");
  }

  return supabase;
}

async function getProfilesByEmail(emails: string[]) {
  const client = assertSupabase();
  const uniqueEmails = [...new Set(emails.filter(Boolean))];
  if (!uniqueEmails.length) return new Map<string, ProfileRow>();

  const { data, error } = await client.from("profiles").select("id,email").in("email", uniqueEmails);
  if (error) throw error;

  return new Map((data || []).map((profile) => [profile.email, profile as ProfileRow]));
}

async function getEmailsByProfileId(ids: string[]) {
  const client = assertSupabase();
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map<string, string>();

  const { data, error } = await client.from("profiles").select("id,email").in("id", uniqueIds);
  if (error) throw error;

  return new Map((data || []).map((profile) => [profile.id, profile.email]));
}

export async function loadSupabaseLembretes(): Promise<Lembrete[]> {
  const client = assertSupabase();

  const { data: lembretes, error } = await client
    .from("lembretes")
    .select("id,titulo,descricao,prazo,prioridade,status,created_by,created_at,updated_at")
    .order("prazo", { ascending: true, nullsFirst: false });

  if (error) throw error;
  if (!lembretes?.length) return [];

  const ids = lembretes.map((lembrete) => lembrete.id);
  const { data: usuarios, error: usuariosError } = await client
    .from("lembrete_usuarios")
    .select("lembrete_id,user_id")
    .in("lembrete_id", ids);
  if (usuariosError) throw usuariosError;

  const { data: anexos, error: anexosError } = await client
    .from("lembrete_anexos")
    .select("lembrete_id,file_name")
    .in("lembrete_id", ids);
  if (anexosError) throw anexosError;

  const emailByProfileId = await getEmailsByProfileId((usuarios || []).map((usuario) => usuario.user_id));

  return (lembretes as LembreteRow[]).map((row) =>
    withResolvedStatus(
      normalizeLembrete({
        id: row.id,
        titulo: row.titulo,
        descricao: row.descricao || "",
        prazo: row.prazo || "",
        prioridade: row.prioridade,
        status: row.status,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        responsaveis: (usuarios || [])
          .filter((usuario) => usuario.lembrete_id === row.id)
          .map((usuario) => emailByProfileId.get(usuario.user_id) || usuario.user_id),
        anexos: (anexos || []).filter((anexo) => anexo.lembrete_id === row.id).map((anexo) => anexo.file_name)
      })
    )
  );
}

export async function upsertSupabaseLembrete(lembrete: Lembrete, user: HubUser) {
  const client = assertSupabase();
  if (!user.id) throw new Error("Sessao Supabase sem ID de usuario.");
  const createdBy = lembrete.createdBy && lembrete.createdBy.includes("-") ? lembrete.createdBy : user.id;

  const { data, error } = await client
    .from("lembretes")
    .upsert({
      id: lembrete.id,
      titulo: lembrete.titulo,
      descricao: lembrete.descricao,
      prazo: lembrete.prazo || null,
      prioridade: lembrete.prioridade,
      status: lembrete.status,
      created_by: createdBy
    })
    .select("id")
    .single();

  if (error) throw error;

  const lembreteId = data.id as string;
  const profilesByEmail = await getProfilesByEmail(lembrete.responsaveis);

  await client.from("lembrete_usuarios").delete().eq("lembrete_id", lembreteId);

  const userLinks = lembrete.responsaveis
    .map((email) => profilesByEmail.get(email)?.id)
    .filter((id): id is string => Boolean(id))
    .map((userId) => ({ lembrete_id: lembreteId, user_id: userId }));

  if (userLinks.length) {
    const { error: linksError } = await client.from("lembrete_usuarios").insert(userLinks);
    if (linksError) throw linksError;
  }

  return lembreteId;
}

export async function deleteSupabaseLembrete(id: string) {
  const client = assertSupabase();
  const { error } = await client.from("lembretes").delete().eq("id", id);
  if (error) throw error;
}

export async function uploadSupabaseLembreteAnexo(lembreteId: string, file: File, user: HubUser) {
  const client = assertSupabase();
  if (!user.id) throw new Error("Sessao Supabase sem ID de usuario.");

  const storagePath = `${lembreteId}/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await client.storage.from("hub-anexos").upload(storagePath, file, {
    upsert: false,
    contentType: file.type || undefined
  });
  if (uploadError) throw uploadError;

  const { error: metadataError } = await client.from("lembrete_anexos").insert({
    lembrete_id: lembreteId,
    file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: user.id
  });
  if (metadataError) throw metadataError;

  return storagePath;
}
