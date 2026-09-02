import { db } from './db.js';
import { fetchSource } from './apify.js';
import { deliverPendingAlerts } from './alerts.js';
import { enabledSources } from './sources.js';

export async function runScan({maxItems=200,fetchImpl=fetch,deliver=true}={}){
  const startedAt=new Date().toISOString();
  const run=db.prepare(`INSERT INTO scan_runs(started_at,status) VALUES(?,'running')`).run(startedAt);
  const runId=Number(run.lastInsertRowid);
  try{
    const results=[];
    for(const source of enabledSources()){
      for(const listingType of ['sale','rent']){
        const sourceStartedAt=new Date().toISOString();
        const child=db.prepare(`INSERT INTO source_scan_runs(scan_run_id,source,listing_type,started_at,status) VALUES(?,?,?,?,'running')`).run(runId,source.id,listingType,sourceStartedAt);
        const childId=Number(child.lastInsertRowid);
        try{
          const result=await fetchSource(source.id,listingType,{monitorMode:true,maxItems,fetchImpl});
          db.prepare(`UPDATE source_scan_runs SET finished_at=?,status='completed',items=?,alerts_created=? WHERE id=?`).run(new Date().toISOString(),result.fetched,result.alertsCreated,childId);
          results.push({source:source.id,listingType,status:'completed',...result});
        }catch(error){
          db.prepare(`UPDATE source_scan_runs SET finished_at=?,status='failed',error_message=? WHERE id=?`).run(new Date().toISOString(),error.message,childId);
          results.push({source:source.id,listingType,status:'failed',error:error.message,fetched:0,alertsCreated:0});
        }
      }
    }
    const saleItems=results.filter((item)=>item.listingType==='sale').reduce((sum,item)=>sum+item.fetched,0);
    const rentItems=results.filter((item)=>item.listingType==='rent').reduce((sum,item)=>sum+item.fetched,0);
    const alertsCreated=results.reduce((sum,item)=>sum+item.alertsCreated,0);
    const completed=results.filter((item)=>item.status==='completed').length;
    if(!completed)throw new Error(results.map((item)=>`${item.source}/${item.listingType}: ${item.error}`).join('; '));
    const delivery=deliver?await deliverPendingAlerts(fetchImpl):{delivered:0,skipped:alertsCreated,reason:'delivery_disabled'};
    const status=completed===results.length?'completed':'completed';
    db.prepare(`UPDATE scan_runs SET finished_at=?,status=?,sale_items=?,rent_items=?,alerts_created=?,error_message=? WHERE id=?`).run(new Date().toISOString(),status,saleItems,rentItems,alertsCreated,completed<results.length?'partial_source_failure':null,runId);
    return {runId,status,partial:completed<results.length,results,alertsCreated,delivery};
  }catch(error){
    db.prepare(`UPDATE scan_runs SET finished_at=?,status='failed',error_message=? WHERE id=?`).run(new Date().toISOString(),error.message,runId);
    throw error;
  }
}
