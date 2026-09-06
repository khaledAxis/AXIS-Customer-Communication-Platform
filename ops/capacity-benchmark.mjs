import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, totalmem, platform } from "node:os";

/** Runs only inside container-smoke's owned synthetic environment; no arbitrary target CLI. */
export async function benchmark({ docker, envArgs, database, network, sourceUrl, migratorImage, appImage, apps, origins, cookie, workspace }) {
  assert.match(database, /^axis-ops-[a-f0-9]{8}-db$/);
  assert.equal(new URL(sourceUrl).pathname, "/axis_ops_test");
  origins.forEach(origin => assert.equal(new URL(origin).hostname, "127.0.0.1"));
  const results = [];
  let previous = 0;
  for (const contacts of [500, 2000, 10000]) {
    const seed = `
      const {PrismaClient}=require('@prisma/client'); const {PrismaPg}=require('@prisma/adapter-pg');
      const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
      (async()=>{
        const previous=${previous}, count=${contacts};
        const user=await p.user.findUniqueOrThrow({where:{email:'operations@axis-test.invalid'}});
        for(let start=previous;start<count;start+=500){
          const values=Array.from({length:Math.min(500,count-start)},(_,j)=>start+j);
          await p.company.createMany({data:values.map(i=>({id:'bench-co-'+i,mondayBoardId:'BENCHMARK',mondayItemId:String(i),
            name:'Synthetic company '+i,customerStatus:'ACTIVE',companyEmail:'bench-'+i+'@capacity.invalid',companyEmailNorm:'bench-'+i+'@capacity.invalid'}))});
          await p.contact.createMany({data:values.map(i=>({id:'bench-ct-'+i,mondayBoardId:'BENCHMARK',mondayItemId:String(i),
            fullName:'Synthetic contact '+i,email:'bench-'+i+'@capacity.invalid',emailNorm:'bench-'+i+'@capacity.invalid'}))});
          await p.companyContact.createMany({data:values.map(i=>({companyId:'bench-co-'+i,contactId:'bench-ct-'+i,assertedBy:'CONTACTS'}))});
          await p.communicationAddress.createMany({data:values.map(i=>({normalizedEmail:'bench-'+i+'@capacity.invalid',language:i%5?'HE':'AR',consentStatus:i%7?'GRANTED':'UNKNOWN'}))});
        }
        const segment=await p.segment.create({data:{name:'Synthetic capacity '+count,criteria:{version:1,conditions:[],groups:[],include:{companyEmails:true,contactEmails:true}}}});
        const campaign=await p.campaign.create({data:{name:'Synthetic benchmark '+count,subject:'Synthetic capacity fixture',language:'HE',createdById:user.id,segmentId:segment.id}});
        const audience=await p.campaignFinalAudience.create({data:{campaignId:campaign.id,segmentName:'Synthetic benchmark',segmentCriteria:{},campaignLanguage:'HE',
          matchedCompanies:count,matchedContacts:count,matchedRecords:count*2,withCandidateEmail:count*2,eligible:count,uniqueDestinations:count,
          excluded:0,duplicateSourcesCollapsed:count,breakdown:{},audienceHash:'synthetic-benchmark-only',createdById:user.id}});
        for(let start=0;start<count;start+=500){
          await p.campaignRecipient.createMany({data:Array.from({length:Math.min(500,count-start)},(_,j)=>({campaignId:campaign.id,finalAudienceId:audience.id,
            normalizedEmail:'bench-'+(start+j)+'@capacity.invalid',intendedEmail:'bench-'+(start+j)+'@capacity.invalid',state:'PENDING'}))});
        }
        console.log(JSON.stringify({campaignId:campaign.id,contacts:await p.contact.count(),companies:await p.company.count(),ledgerRows:await p.campaignRecipient.count()}));
      })().finally(()=>p.$disconnect());`;
    const fixture = JSON.parse((await docker(["run", "--rm", "--network", network, "--entrypoint", "node", ...envArgs({ DATABASE_URL: sourceUrl }), migratorImage, "-e", seed])).stdout);
    const routes = ["/customers", "/communication", "/reports", `/reports/${fixture.campaignId}`, `/newsletters/${fixture.campaignId}/readiness`, "/api/health/ready"];
    // Warm each route on both replicas. Timings below include full response download, no assets.
    for (const origin of origins) for (const route of routes) {
      const response = await fetch(origin+route,{headers:{Cookie:cookie},redirect:"manual"});
      assert.equal(response.status,200); await response.arrayBuffer();
    }
    for (const concurrency of [1,5,10]) {
      const observations=[]; let next=0; const requests=60; const began=performance.now();
      await Promise.all(Array.from({length:concurrency},async()=>{
        for (;;) {
          const index=next++; if(index>=requests)break;
          const route=routes[index%routes.length]; const start=performance.now();
          try {
            const response=await fetch(origins[index%origins.length]+route,{headers:{Cookie:cookie},redirect:"manual",signal:AbortSignal.timeout(30000)});
            const body=await response.arrayBuffer();
            observations.push({route:route.startsWith('/reports/')?'/reports/:id':route.startsWith('/newsletters/')?'/newsletters/:id/readiness':route,status:response.status,ms:performance.now()-start,bytes:body.byteLength});
          } catch { observations.push({route,status:0,ms:performance.now()-start,bytes:0}); }
        }
      }));
      const elapsed=performance.now()-began;
      const sorted=observations.map(row=>row.ms).sort((a,b)=>a-b);
      const percentile=p=>Math.round(sorted[Math.ceil(sorted.length*p)-1]);
      const result={...fixture,concurrency,requests,errors:observations.filter(row=>row.status!==200).length,
        p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:Math.round(sorted.at(-1)),requestsPerSecond:Number((requests/(elapsed/1000)).toFixed(2)),
        routes:routes.map(route=>route.startsWith('/reports/')?'/reports/:id':route.startsWith('/newsletters/')?'/newsletters/:id/readiness':route).map(route=>{
          const values=observations.filter(row=>row.route===route).map(row=>row.ms).sort((a,b)=>a-b);
          return {route,p95Ms:Math.round(values[Math.ceil(values.length*.95)-1])};
        })};
      results.push(result); console.log(JSON.stringify({event:"capacity_sample",...result,campaignId:undefined}));
    }
    previous=contacts;
  }
  const resources=(await docker(["stats","--no-stream","--format","{{json .}}",...apps,database])).stdout;
  const connections=(await docker(["exec",database,"psql","-U","axis","-d","axis_ops_test","-At","-c",
    "SELECT count(*) FROM pg_stat_activity WHERE datname='axis_ops_test'"])).stdout;
  const output={timestamp:new Date().toISOString(),appImage,environment:{platform:platform(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,
    hostMemoryGiB:Number((totalmem()/2**30).toFixed(1)),replicas:2,poolPerReplica:3,connectionsAtEnd:Number(connections)},
    scope:"Synthetic local Docker HTTP responses after warm-up. No assets, browser rendering, provider throughput, or production SLA claim.",results,resources};
  writeFileSync(join(workspace,"var","capacity-benchmark.json"),JSON.stringify(output,null,2));
  const lines=["# Synthetic capacity benchmark","",output.scope,"",`Run: ${output.timestamp}. Image: ${appImage}. Two app replicas, pool size 3 each.`,"",
    "| Contacts | Companies | Ledger rows | Concurrency | Requests | Errors | p50 ms | p95 ms | Requests/s |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",...results.map(r=>`| ${r.contacts} | ${r.companies} | ${r.ledgerRows} | ${r.concurrency} | ${r.requests} | ${r.errors} | ${r.p50Ms} | ${r.p95Ms} | ${r.requestsPerSecond} |`),"",
    "Provider submissions are separately limited to one globally reserved slot per 550 ms. This benchmark sends no email and makes no Monday call.",""];
  writeFileSync(join(workspace,"var","capacity-benchmark.md"),lines.join("\n"));
  assert.equal(results.reduce((sum,row)=>sum+row.errors,0),0,"Benchmark requests must all succeed; see the saved report.");
}
