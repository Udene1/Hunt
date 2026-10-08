import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/auth";
import { databaseConfigured, prisma } from "../../../../lib/db";
import { monitoringEntitled } from "../../../../lib/entitlements";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!databaseConfigured()) return NextResponse.json({ error:"Database unavailable" }, {status:503});
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Authentication required."},{status:401});
  if(!monitoringEntitled(user)) return NextResponse.json({error:"Pilot or paid access required."},{status:402});
  const {id}=await params;
  const body=await request.json().catch(()=>({}));
  const state=String(body.investigationState||"");
  const allowed=["not_investigated","investigating","qualified","rejected","actionable","executed","closed"];
  if(!allowed.includes(state)) return NextResponse.json({error:"Invalid investigationState",allowed},{status:400});
  const candidate=await prisma.opportunityCandidate.findFirst({where:{id,userId:user.id}});
  if(!candidate) return NextResponse.json({error:"Opportunity not found"},{status:404});
  const updated=await prisma.opportunityCandidate.update({where:{id},data:{investigationState:state,investigationNotes:body.notes==null?candidate.investigationNotes:String(body.notes),investigatedAt:state==="not_investigated"?null:new Date(),status:state==="rejected"?"rejected":state==="actionable"?"actionable":candidate.status}});
  return NextResponse.json({opportunity:updated});
}