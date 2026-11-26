import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";
import { scriptDb } from "./script-db";

const base = new URL(process.env.APP_URL || "http://127.0.0.1:3000");
const run = randomUUID();
const admin = {id:randomUUID(),email:`composer-${run}@example.invalid`,name:"Composer integration test",role:"admin"};
const category = {id:randomUUID(),name:`COMPOSER ${run}`,slug:`composer-${run}`};
const nonces = new Set<string>(); const limits = new Set<string>(); const postIds = new Set<string>(); const assetIds = new Set<string>();
let adminCookie = ""; let passed = 0; let stage = "setup";
type Settings = {commentsModerationEnabled:boolean;postsModerationEnabled:boolean;defaultCategoryId:string|null;version:number};
let original:Settings|undefined; let current:Settings|undefined;
class Failure extends Error {}
function assert(condition:unknown,message:string):asserts condition {if(!condition)throw new Failure(message);}
function legacySubmissionHash(value:object){
  const secret=process.env.BETTER_AUTH_SECRET?.trim();assert(secret&&secret.length>=32,"The local test signing key is unavailable");
  // Reproduce only this fixture's pre-NFKC receipt format; never print signing material.
  return createHmac("sha256",secret).update(`submission-payload:${JSON.stringify(value)}`).digest("base64url");
}
async function test(name:string,fn:()=>Promise<void>){stage=name;await fn();console.log(`PASS ${++passed}: ${name}`);}
async function request(method:string,url:string,expected:number|number[],options:{json?:unknown;form?:FormData;cookie?:string;origin?:string;headers?:Record<string,string>}={}){
  const headers=new Headers(options.headers);if(method!=="GET"&&method!=="HEAD")headers.set("Origin",options.origin??base.origin);if(options.cookie)headers.set("Cookie",options.cookie);if(options.json!==undefined)headers.set("Content-Type","application/json");
  const response=await fetch(new URL(url,base),{method,headers,body:options.form??(options.json===undefined?undefined:JSON.stringify(options.json)),redirect:"manual",signal:AbortSignal.timeout(120_000)});
  assert((Array.isArray(expected)?expected:[expected]).includes(response.status),`${method} ${url}: expected ${expected}, got ${response.status}`);return response;
}
async function read<T>(response:Response){return await response.json() as T;}
async function status(method:string,url:string,expected:number,options:Parameters<typeof request>[3]={}){await(await request(method,url,expected,options)).arrayBuffer();}
async function settings(){const {commentsModerationEnabled,postsModerationEnabled,defaultCategoryId,version}=(await read<{settings:Settings}>(await request("GET","/api/admin/settings",200,{cookie:adminCookie}))).settings;return{commentsModerationEnabled,postsModerationEnabled,defaultCategoryId,version};}
async function configure(patch:Partial<Settings>){const before=await settings();await(await request("PATCH","/api/admin/settings",200,{cookie:adminCookie,json:{...before,...patch}})).arrayBuffer();current=await settings();return current;}
type Ticket={token:string;nonce:string;cookie:string;readyAt:number;mode:boolean};
async function ticket():Promise<Ticket>{
  const response=await request("GET","/api/submissions/form",200);
  const cookie=response.headers.getSetCookie().find(v=>v.startsWith("submission_visitor="))?.split(";")[0];assert(cookie,"No signed visitor cookie");
  const value=await read<{token:string;minDelayMs:number;moderationEnabled:boolean}>(response);
  const payload=JSON.parse(Buffer.from(value.token.split(".")[0],"base64url").toString()) as{nonce:string;visitor:string};
  nonces.add(payload.nonce);limits.add(`submissions:accepted:${payload.visitor}`);limits.add(`submissions:attempts:${payload.visitor}`);
  return {token:value.token,nonce:payload.nonce,cookie,readyAt:Date.now()+value.minDelayMs+50,mode:value.moderationEnabled};
}
type Payload={title?:string;content?:string;displayName?:string;anonymous?:string;contact?:string;contactConsent?:string;photos?:Buffer[];video?:{data:Buffer;type:string;name:string}};
function form(t:Ticket,values:Payload){const data=new FormData();data.set("token",t.token);data.set("website","");for(const key of["title","content","displayName","anonymous","contact","contactConsent"]as const)if(values[key]!==undefined)data.set(key,values[key]!);for(const photo of values.photos??[])data.append("photos",new File([Uint8Array.from(photo).buffer],"test.png",{type:"image/png"}));if(values.video)data.set("video",new File([Uint8Array.from(values.video.data).buffer],values.video.name,{type:values.video.type}));return data;}
async function send(t:Ticket,values:Payload,expected=201){if(t.readyAt>Date.now())await delay(t.readyAt-Date.now());return read<{success?:boolean;status?:string;post?:{slug:string}}>(await request("POST","/api/submissions",expected,{cookie:t.cookie,form:form(t,values)}));}
async function saved(t:Ticket){const row=await scriptDb.submission.findUnique({where:{receiptKey:t.nonce},include:{images:{include:{media:true}}}});assert(row,"Accepted submission missing");if(row.postId)postIds.add(row.postId);for(const image of row.images)assetIds.add(image.mediaId);return row;}
type Post={id:string;slug:string;version:number;title:string;content:string;videos:{id:string;kind:string}[];images:{id:string}[]};
async function getPost(id:string){return(await read<{post:Post}>(await request("GET",`/api/admin/posts/${id}`,200,{cookie:adminCookie}))).post;}
async function patchPost(post:Post,values:object){return(await read<{post:Post}>(await request("PATCH",`/api/admin/posts/${post.id}`,200,{cookie:adminCookie,json:{version:post.version,...values}}))).post;}

async function main(){
  assert(["127.0.0.1","localhost","[::1]"].includes(base.hostname),"Only local tests are allowed");
  await test("settings require administrator authorization and CSRF origin",async()=>{
    await status("GET","/api/admin/settings",401);await status("PATCH","/api/admin/settings",401,{json:{}});
    const password=randomBytes(32).toString("base64url");await scriptDb.user.create({data:{...admin,accounts:{create:{id:randomUUID(),accountId:admin.id,providerId:"credential",password:await hashPassword(password)}}}});await scriptDb.category.create({data:category});
    const login=await request("POST","/api/auth/sign-in/email",200,{json:{email:admin.email,password}});adminCookie=login.headers.getSetCookie().find(v=>v.startsWith("my-kineshma.session_token="))?.split(";")[0]??"";await login.arrayBuffer();assert(adminCookie,"Admin cookie missing");
    original=await settings();current=original;await status("PATCH","/api/admin/settings",403,{cookie:adminCookie,origin:"https://other.example.invalid",json:original});
    await configure({commentsModerationEnabled:false,postsModerationEnabled:true,defaultCategoryId:category.id});
  });
  await test("moderation toggles are independent, versioned and validate the default category",async()=>{
    const stale=current!;await configure({commentsModerationEnabled:true});assert(current!.postsModerationEnabled,"Comment setting changed post moderation");
    await status("PATCH","/api/admin/settings",409,{cookie:adminCookie,json:stale});
    await status("PATCH","/api/admin/settings",400,{cookie:adminCookie,json:{...current!,postsModerationEnabled:false,defaultCategoryId:null}});
    await status("PATCH","/api/admin/settings",400,{cookie:adminCookie,json:{...current!,defaultCategoryId:randomUUID()}});
    await status("DELETE",`/api/admin/categories/${category.id}`,409,{cookie:adminCookie});
    await configure({commentsModerationEnabled:false});
  });
  const png=await sharp({create:{width:64,height:48,channels:3,background:"#60a5fa"}}).png().toBuffer();
  const mp4=await readFile("tests/fixtures/flower.mp4");const webm=await readFile("tests/fixtures/flower.webm");
  let photoTicket:Ticket;let photoSubmission:Awaited<ReturnType<typeof saved>>;
  await test("photo-only, one-character text and one-character title need no extra fields",async()=>{
    photoTicket=await ticket();assert(photoTicket.mode,"Submission form does not reflect moderation setting");const response=await send(photoTicket,{photos:[png]});assert(response.status==="PENDING","Photo bypassed moderation");photoSubmission=await saved(photoTicket);assert(photoSubmission.title===""&&photoSubmission.content===""&&photoSubmission.images.length===1,"Photo-only submission changed content");
    for(const value of[{content:"я"},{title:"!"}]){const t=await ticket();await send(t,value);const row=await saved(t);assert(row.title===(value.title??"")&&row.content===(value.content??""),"Single character was not retained");}
    await status("GET",`/media/${photoSubmission.images[0].mediaId}`,404);
  });
  await test("empty submission and malformed fields are rejected without a receipt",async()=>{
    const t=await ticket();await send(t,{},400);await send(t,{content:"ok",displayName:"bad\u0000name"},400);await send(t,{title:"x".repeat(181)},400);await send(t,{content:"x".repeat(20001)},400);
    assert(await scriptDb.submissionReceipt.count({where:{key:t.nonce}})===0,"Invalid form created a receipt");
  });
  await test("pre-normalization submission receipts accept legacy names without recreating a deleted material",async()=>{
    const t=await ticket();const rawName=" Ａｎｎａ ";const content=`COMPOSER_LEGACY_NAME_${run}`;
    const payloadHash=legacySubmissionHash({title:"",content,anonymous:false,senderName:null,contact:null,publicAuthorName:rawName.trim(),photos:[]});
    await scriptDb.submissionReceipt.create({data:{key:t.nonce,payloadHash,acceptedStatus:"PENDING"}});
    const before=await scriptDb.post.count({where:{categoryId:category.id}});
    const accepted=await send(t,{content,anonymous:"false",displayName:rawName},200);
    assert(accepted.success&&accepted.status==="PENDING","Legacy retry lost its accepted moderation status");
    await send(t,{content:`${content} changed`,anonymous:"false",displayName:rawName},409);
    assert(await scriptDb.submission.count({where:{receiptKey:t.nonce}})===0&&await scriptDb.post.count({where:{categoryId:category.id}})===before,"Legacy retry recreated a deleted submission or post");
    const receipt=await scriptDb.submissionReceipt.findUniqueOrThrow({where:{key:t.nonce}});
    assert(receipt.payloadHash===payloadHash&&receipt.acceptedStatus==="PENDING","Legacy compatibility rewrote the submission receipt");
  });
  await test("turning moderation off affects only new requests and retries cannot republish a queued post",async()=>{
    await configure({postsModerationEnabled:false});assert(current!.commentsModerationEnabled===false,"Post setting changed comment setting");
    const repeated=await send(photoTicket,{photos:[png]},200);assert(repeated.status==="PENDING"&&!(await saved(photoTicket)).postId,"An old pending request was auto-published");
  });
  let immediateTicket:Ticket; let immediatePost:Post;
  await test("immediate publication keeps public name but never exposes the optional private contact",async()=>{
    immediateTicket=await ticket();assert(!immediateTicket.mode,"Form did not reflect immediate publishing");
    const values={content:`COMPOSER_PUBLIC_${run}`,anonymous:"false",displayName:"Тестовый автор",contact:`PRIVATE_CONTACT_${run}`,contactConsent:"true"};
    const response=await send(immediateTicket,values);assert(response.status==="APPROVED"&&response.post?.slug,"Autopublishing did not return its original permalink");
    const row=await saved(immediateTicket);assert(row.postId&&row.publicAuthorName===values.displayName&&row.contact===values.contact,"Public/private name semantics incorrect");immediatePost=await getPost(row.postId);
    const stored=await scriptDb.post.findUniqueOrThrow({where:{id:row.postId}});assert(stored.authorId===null&&stored.sourceType==="RESIDENT"&&stored.categoryId===category.id,"Guest publication impersonates an admin or uses wrong category");
    const html=await(await request("GET",`/news/${immediatePost.slug}`,200)).text();assert(html.includes(values.displayName)&&!html.includes(values.contact),"Private contact leaked or chosen public name missing");
    const counts=await scriptDb.post.count({where:{id:row.postId}});await send(immediateTicket,values,200);assert(await scriptDb.post.count({where:{id:row.postId}})===counts,"Retry duplicated an immediate publication");
  });
  await test("prohibited named publication signatures return 400 without a submission, receipt or public post",async()=>{
    const t=await ticket();assert(!t.mode,"Nickname rejection must also protect direct publication");
    const before=await scriptDb.post.count({where:{categoryId:category.id}});
    await delay(Math.max(0,t.readyAt-Date.now()));
    for(const name of["ДОЛБОЁБ","сука123"]){
      const response=await request("POST","/api/submissions",400,{cookie:t.cookie,form:form(t,{content:`Проверка имени ${run}`,anonymous:"false",displayName:name})});
      const body=await read<{fieldErrors?:Record<string,unknown>}>(response);
      assert(typeof body.fieldErrors?.displayName==="string","A prohibited publication nickname needs a displayName field error");
    }
    assert(await scriptDb.submission.count({where:{receiptKey:t.nonce}})===0,"A prohibited nickname created a submission");
    assert(await scriptDb.submissionReceipt.count({where:{key:t.nonce}})===0,"A prohibited nickname consumed its submission receipt");
    assert(await scriptDb.post.count({where:{categoryId:category.id}})===before,"A prohibited nickname bypassed direct publication validation");
  });
  await test("anonymous publication drops display name and retains only explicitly supplied private contact",async()=>{
    const t=await ticket();await send(t,{content:"Анонимная проверка",anonymous:"true",displayName:"SHOULD_NOT_PUBLISH",contact:`ANON_CONTACT_${run}`,contactConsent:"true"});
    const row=await saved(t);assert(row.publicAuthorName===null&&row.contact===`ANON_CONTACT_${run}`&&row.postId,"Anonymous semantics incorrect");
    const post=await getPost(row.postId);const html=await(await request("GET",`/news/${post.slug}`,200)).text();assert(!html.includes("SHOULD_NOT_PUBLISH")&&!html.includes(`ANON_CONTACT_${run}`),"Anonymous identity/contact leaked");
  });
  await test("concurrent immediate submission retries create one post and retain acceptance after settings change",async()=>{
    const t=await ticket();await delay(Math.max(0,t.readyAt-Date.now()));const responses=await Promise.all([request("POST","/api/submissions",[200,201],{cookie:t.cookie,form:form(t,{content:"Параллельная проверка"})}),request("POST","/api/submissions",[200,201],{cookie:t.cookie,form:form(t,{content:"Параллельная проверка"})})]);assert(responses.map(response=>response.status).sort().join(',')==='200,201','Concurrent retries did not have one acceptance');for(const response of responses)await response.arrayBuffer();
    const row=await saved(t);assert(row.postId&&await scriptDb.post.count({where:{submission:{receiptKey:t.nonce}}})===1,"Immediate retries created more than one post");
    await configure({postsModerationEnabled:true});assert((await send(t,{content:"Параллельная проверка"},200)).status==="APPROVED","Retry forgot its acceptance mode");
  });
  let videoPost:Post;let videoMediaId:string;
  await test("video-only submission is probed and stays private until approval",async()=>{
    const t=await ticket();await send(t,{video:{data:mp4,type:"video/mp4",name:"flower.mp4"}});const row=await saved(t);const media=row.images[0].media;videoMediaId=media.id;
    assert(media.kind==="VIDEO"&&media.mimeType==="video/mp4"&&media.width===960&&media.height===540&&(media.duration??0)>5,"Server video inspection did not persist correct playback metadata");
    await status("GET",`/media/${media.id}`,404,{headers:{Range:"bytes=0-127"}});
    await status("POST",`/api/admin/submissions/${row.id}/approve`,200,{cookie:adminCookie,json:{version:row.version,title:"",content:"",categoryId:category.id,imageIds:[],videoIds:[media.id]}});
    const approved=await saved(t);assert(approved.postId,"Video-only approval has no post");videoPost=await getPost(approved.postId);assert(videoPost.images.length===0&&videoPost.videos[0]?.id===media.id,"Video was returned as a photo");
  });
  await test("native video supports byte ranges, suffix ranges and HEAD without bypassing access",async()=>{
    const partial=await request("GET",`/media/${videoMediaId}`,206,{headers:{Range:"bytes=0-127"}});assert(partial.headers.get("content-type")==="video/mp4"&&partial.headers.get("accept-ranges")==="bytes"&&partial.headers.get("content-range")===`bytes 0-127/${mp4.length}`&&(await partial.arrayBuffer()).byteLength===128,"Video seeking range failed");
    const suffix=await request("GET",`/media/${videoMediaId}`,206,{headers:{Range:"bytes=-32"}});assert((await suffix.arrayBuffer()).byteLength===32,"Suffix range failed");
    // Next 16.4.6 intentionally strips Content-Length from route handlers.
    // Range carries the authoritative total; HEAD must advertise type/ranges and send no body.
    const head=await request("HEAD",`/media/${videoMediaId}`,200);assert(head.headers.get("content-type")==="video/mp4"&&head.headers.get("accept-ranges")==="bytes"&&(await head.arrayBuffer()).byteLength===0,"HEAD has incorrect media metadata or a body");
    await status("GET",`/media/${videoMediaId}`,416,{headers:{Range:"bytes=999999999-"}});await status("GET",`/media/${videoMediaId}`,416,{headers:{Range:"bytes=0-1,4-5"}});
    const html=await(await request("GET",`/news/${videoPost.slug}`,200)).text();assert(html.includes("<video")&&html.includes(`/media/${videoMediaId}`),"Published upload is not rendered in a native video player");
    videoPost=await patchPost(videoPost,{status:"UNPUBLISHED"});await status("GET",`/media/${videoMediaId}`,404,{headers:{Range:"bytes=0-127"}});await status("HEAD",`/media/${videoMediaId}`,404);videoPost=await patchPost(videoPost,{status:"PUBLISHED"});
  });
  await test("video attachments survive omitted PATCH fields and cannot masquerade as photographs",async()=>{
    videoPost=await patchPost(videoPost,{title:"Новый заголовок"});assert(videoPost.videos[0]?.id===videoMediaId,"A legacy PATCH silently detached video");
    await status("PATCH",`/api/admin/posts/${videoPost.id}`,400,{cookie:adminCookie,json:{version:videoPost.version,imageIds:[videoMediaId],videoIds:[]}});
    await status("PATCH",`/api/admin/posts/${videoPost.id}`,400,{cookie:adminCookie,json:{version:videoPost.version,imageIds:[],videoIds:[photoSubmission.images[0].mediaId]}});
  });
  await test("WebM admin upload, titleless video publication and one-character edit work",async()=>{
    const body=new FormData();body.set("file",new File([Uint8Array.from(webm).buffer],"flower.webm",{type:"video/webm"}));const uploaded=await read<{media:{id:string;kind:string}}>(await request("POST","/api/admin/uploads",201,{cookie:adminCookie,form:body}));assetIds.add(uploaded.media.id);assert(uploaded.media.kind==="VIDEO","WebM upload has wrong kind");
    const post=(await read<{post:Post}>(await request("POST","/api/admin/posts",201,{cookie:adminCookie,json:{title:"",content:"",status:"PUBLISHED",categoryId:category.id,imageIds:[],videoIds:[uploaded.media.id]}}))).post;postIds.add(post.id);assert(post.videos.length===1,"Admin WebM attachment lost");const changed=await patchPost(post,{title:"!",content:"я"});assert(changed.title==="!"&&changed.content==="я"&&changed.videos.length===1,"Single-character post edit failed");
  });
  await test("fake and oversized video files are rejected before any publication",async()=>{
    const t=await ticket();await send(t,{video:{data:png,type:"video/mp4",name:"fake.mp4"}},415);await send(t,{video:{data:mp4.subarray(0,80),type:"video/mp4",name:"truncated.mp4"}},415);
    await send(t,{video:{data:Buffer.alloc(50*1024*1024+1),type:"video/mp4",name:"oversized.mp4"}},413);assert(await scriptDb.submission.count({where:{receiptKey:t.nonce}})===0,"Invalid video was accepted");
  });
}
async function cleanup(){
  let restoreError:unknown;
  try { if(original&&current){const latest=await settings();if(latest.version!==current.version)throw new Failure("Settings were changed externally; refusing to overwrite them during cleanup");await configure({commentsModerationEnabled:original.commentsModerationEnabled,postsModerationEnabled:original.postsModerationEnabled,defaultCategoryId:original.defaultCategoryId});} } catch(error) { restoreError=error; }
  const submissions=await scriptDb.submission.findMany({where:{receiptKey:{in:[...nonces]}},include:{images:true}});for(const row of submissions){if(row.postId)postIds.add(row.postId);for(const image of row.images)assetIds.add(image.mediaId);}
  await scriptDb.submission.deleteMany({where:{receiptKey:{in:[...nonces]}}});await scriptDb.post.deleteMany({where:{id:{in:[...postIds]}}});await scriptDb.submissionReceipt.deleteMany({where:{key:{in:[...nonces]}}});
  const files=await scriptDb.mediaAsset.findMany({where:{id:{in:[...assetIds]},posts:{none:{}},submissions:{none:{}}}});await scriptDb.mediaAsset.deleteMany({where:{id:{in:files.map(file=>file.id)},posts:{none:{}},submissions:{none:{}}}});
  const directory=path.resolve(process.env.UPLOAD_DIR||"storage/uploads");for(const file of files){assert(/^[a-f0-9-]{36}\.(webp|mp4|webm)$/.test(file.filename),"Unexpected fixture filename");await unlink(path.join(directory,file.filename)).catch(()=>{});}
  await scriptDb.category.deleteMany({where:{id:category.id,name:category.name,defaultForSettings:{none:{}}}});await scriptDb.user.deleteMany({where:{id:admin.id,email:admin.email}});limits.add(`uploads:${admin.id}`);limits.add(`login:${createHash("sha256").update(admin.email).digest("hex")}`);await scriptDb.actionLimit.deleteMany({where:{key:{in:[...limits]}}});
  assert(await scriptDb.submissionReceipt.count({where:{key:{in:[...nonces]}}})===0&&await scriptDb.post.count({where:{id:{in:[...postIds]}}})===0,"Owned data remain after cleanup");if(restoreError)throw restoreError;console.log("PASS cleanup: original moderation preferences restored; only owned fixtures removed; shared limits retained.");
}
try{await main();console.log(`All ${passed} composer/settings/video checks passed.`);}catch(error){console.error(`FAIL ${stage}: ${error instanceof Failure?error.message:"Unexpected failure; sensitive details suppressed"}`);process.exitCode=1;}finally{try{await cleanup();}catch(error){console.error(`FAIL cleanup: ${error instanceof Failure?error.message:"Could not finish cleanup"}`);process.exitCode=1;}await scriptDb.$disconnect();}
