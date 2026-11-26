import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { prisma } from "@/server/db/client";
import { getAdminSession } from "@/server/auth/guards";
import { serverConfig } from "@/server/config";
import { validId } from "@/server/news/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie",
  "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
};
type Context = {params:Promise<{id:string}>};
async function serve(request: Request, {params}:Context, head=false) {
  try {
    const id=validId((await params).id);
    const media=await prisma.mediaAsset.findUnique({where:{id},include:{posts:{where:{post:{status:"PUBLISHED",publishedAt:{not:null}}},take:1,select:{postId:true}}}});
    if (!media || (!media.posts.length && !(await getAdminSession(request.headers)))) return new Response(null,{status:404,headers:privateHeaders});
    const extension=media.kind === "VIDEO" ? media.mimeType === "video/mp4" ? "mp4" : media.mimeType === "video/webm" ? "webm" : null : "webp";
    if (!extension || !new RegExp(`^[a-f0-9-]{36}\\.${extension}$`).test(media.filename)) return new Response(null,{status:404,headers:privateHeaders});
    const file=path.join(serverConfig().uploadDirectory,media.filename);
    const {size}=await stat(file);
    let start=0; let end=size-1; let status=200;
    const range=request.headers.get("range");
    if(range) {
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match || (!match[1]&&!match[2])) return new Response(null,{status:416,headers:{...privateHeaders,"Content-Range":`bytes */${size}`}});
      if(!match[1]) { const length=Number(match[2]); if(!Number.isSafeInteger(length)||length<=0) return new Response(null,{status:416,headers:{...privateHeaders,"Content-Range":`bytes */${size}`}}); start=Math.max(0,size-length); }
      else { start=Number(match[1]); end=match[2]?Math.min(Number(match[2]),size-1):size-1; }
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start) return new Response(null,{status:416,headers:{...privateHeaders,"Content-Range":`bytes */${size}`}});
      status=206;
    }
    const headers={...privateHeaders,"Content-Type":media.kind==="VIDEO"?media.mimeType:"image/webp","Content-Length":String(end-start+1),"Accept-Ranges":"bytes","Content-Disposition":`inline; filename="${media.kind==="VIDEO"?"video":"photo"}.${extension}"`,...(status===206?{"Content-Range":`bytes ${start}-${end}/${size}`}:{})};
    return new Response(head?null:Readable.toWeb(createReadStream(file,{start,end})) as ReadableStream<Uint8Array>,{status,headers});
  }catch {return new Response(null,{status:404,headers:privateHeaders});}
}
export async function GET(request:Request,context:Context){return serve(request,context);}
export async function HEAD(request:Request,context:Context){return serve(request,context,true);}
