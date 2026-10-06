import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { databaseConfigured, prisma } from "../../../../lib/db";
import { hashToken } from "../../../../lib/auth";
export const dynamic = "force-dynamic";
function bootstrapAuthorized(request: Request) { const expected=process.env.HUNT_ADMIN_SECRET; const supplied=request.headers.get("x-hunt-admin-secret"); return Boolean(expected && supplied && supplied===expected); }
export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({error:"Database unavailable"},{status:503});
  if (!bootstrapAuthorized(request)) return NextResponse.json({error:"Admin bootstrap authentication required."},{status:401});
  const token="hunt_admin_"+randomBytes(32).toString("base64url");
  const access=await prisma.adminAccessToken.create({data:{tokenHash:hashToken(token),label:"Admin AI"}});
  return NextResponse.json({token,tokenId:access.id,label:access.label,warning:"Store this token securely. Hunt stores only its hash."});
}
export async function DELETE(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({error:"Database unavailable"},{status:503});
  if (!bootstrapAuthorized(request)) return NextResponse.json({error:"Admin bootstrap authentication required."},{status:401});
  const body=await request.json().catch(()=>null);
  if (!body || typeof body.tokenId!=="string") return NextResponse.json({error:"tokenId required."},{status:400});
  await prisma.adminAccessToken.update({where:{id:body.tokenId},data:{revokedAt:new Date()}}).catch(()=>{});
  return NextResponse.json({revoked:true});
}