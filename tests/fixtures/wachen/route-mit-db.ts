// FIXTURE — must FAIL `route-ohne-db`.
export async function GET(): Promise<Response> {
  const zeilen = await db.select().from(rechnung);
  return Response.json(zeilen);
}
