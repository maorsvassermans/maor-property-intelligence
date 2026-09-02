const state={all:[],filtered:[],selectedId:null,map:null,markerLayer:null,markers:new Map()};
const money=new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:0});
const pct=(n)=>`${Number(n||0).toFixed(2)}%`;
const el=(id)=>document.getElementById(id);
const sourceLabels={yad2:'יד2',madlan:'מדלן',homeless:'הומלס',komo:'Komo',ad:'ad.co.il',facebook_marketplace_manual:'Facebook Marketplace',onmap:'OnMap','public-comparable':'השוואת דוגמה'};

function scoreClass(score){return score>=80?'high':score>=60?'mid':'low'}
function scoreColor(score){return score>=85?'#6ee7a8':score>=60?'#f7ca65':'#f98484'}
function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

async function loadDashboard(){
  document.body.classList.add('loading');
  try{
    const response=await fetch('/api/v1/dashboard');
    if(!response.ok)throw new Error('טעינת הנתונים נכשלה');
    const {data}=await response.json();
    state.all=data.listings;
    el('propertiesCount').textContent=data.summary.properties;
    el('salesCount').textContent=data.summary.sales;
    el('rentalsCount').textContent=data.summary.rentals;
    el('dropsCount').textContent=data.summary.priceDrops;
    el('averageScore').textContent=data.summary.averageDealScore;
    el('activeSourcesCount').textContent=data.summary.activeSources;
    const counts=new Map(data.coverage.map((item)=>[item.source,item.listings]));
    el('sourceBadges').innerHTML=data.sources.map((source)=>{const count=counts.get(source.id)||0,status=source.enabled?`${count} מודעות`:source.status==='manual'?(count?`${count} מודעות ידניות`:'קליטה ידנית'):'מוכן לחיבור';return `<span class="source-status ${source.enabled?'enabled':source.status==='manual'?'manual':source.status==='planned'?'planned':''}"><b>${escapeHtml(source.label)}${source.aggregator?' · מאגד':''}</b><small>${status}</small></span>`}).join('');
    el('sourceFilter').innerHTML='<option value="">כל הלוחות</option>'+data.sources.filter((source)=>source.enabled||(counts.get(source.id)||0)>0).map((source)=>`<option value="${escapeHtml(source.id)}">${escapeHtml(source.label)}</option>`).join('');
    applyFilters();
    if(!state.selectedId&&state.filtered[0])selectProperty(state.filtered[0].id);
    await Promise.all([loadAlerts(),loadMarketplaceInbox()]);
  }catch(error){el('propertiesTable').innerHTML=`<tr><td colspan="8">${escapeHtml(error.message)}</td></tr>`}
  finally{document.body.classList.remove('loading')}
}

async function loadAlerts(){
  try{
    const response=await fetch('/api/v1/alerts?unread=true&limit=20');
    if(!response.ok)return;
    const {data}=await response.json(),panel=el('alertsPanel');
    panel.hidden=data.length===0; el('alertsCount').textContent=data.length;
    el('alertsList').innerHTML=data.map((alert)=>`<button class="alert-item ${escapeHtml(alert.severity)}" data-alert-id="${alert.id}" data-listing-id="${alert.listing_id}" type="button"><span class="alert-icon">${alert.type==='price_drop'?'↓':alert.type==='high_score'?'★':'+'}</span><span><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.message)} · ${escapeHtml(alert.street||alert.city)}</small></span></button>`).join('');
    document.querySelectorAll('.alert-item').forEach((button)=>button.addEventListener('click',async()=>{
      const listingId=Number(button.dataset.listingId); if(state.all.some((item)=>item.id===listingId))selectProperty(listingId);
      await fetch(`/api/v1/alerts/${button.dataset.alertId}/read`,{method:'POST'}); button.remove();
      const remaining=el('alertsList').children.length; el('alertsCount').textContent=remaining; panel.hidden=remaining===0;
    }));
  }catch{}
}

function applyFilters(){
  const query=el('searchInput').value.trim().toLowerCase();
  const minScore=Number(el('scoreFilter').value);
  const source=el('sourceFilter').value;
  state.filtered=state.all.filter((item)=>{
    const haystack=[item.city,item.neighborhood,item.street,item.house_number].filter(Boolean).join(' ').toLowerCase();
    const itemSources=String(item.source_names||item.source).split(',');
    return (!query||haystack.includes(query))&&item.analysis.scores.deal>=minScore&&(!source||itemSources.includes(source));
  }).sort((a,b)=>b.analysis.scores.deal-a.analysis.scores.deal);
  renderTable();
}

function renderTable(){
  el('resultCount').textContent=`${state.filtered.length} תוצאות`;
  el('emptyState').hidden=state.filtered.length>0;
  el('propertiesTable').innerHTML=state.filtered.map((item)=>{
    const a=item.analysis, verified=item.address_confidence>=.8;
    return `<tr data-id="${item.id}" class="${state.selectedId===item.id?'selected':''}">
      <td><span class="score ${scoreClass(a.scores.deal)}">${a.scores.deal}</span></td>
      <td class="property-name"><strong>${escapeHtml(item.street||'רחוב לא ידוע')} ${escapeHtml(item.house_number||'')}</strong><small>${escapeHtml(item.neighborhood||'')}, ${escapeHtml(item.city)}</small></td>
      <td><span class="source-pill source-${escapeHtml(item.source)}">${escapeHtml(sourceLabels[item.source]||item.source)}</span>${item.source_count>1?`<small class="multi-source">${item.source_count} לוחות</small>`:''}</td>
      <td>${money.format(item.asking_price)}</td><td>${item.rooms??'לא ידוע'}</td><td>${item.area_sqm??'לא ידוע'}</td>
      <td>${item.listing_type==='rent'?'שכירות':pct(a.grossYieldPct)}</td><td><span class="confidence ${verified?'verified':''}">${verified?'בניין':'רחוב'}</span></td></tr>`;
  }).join('');
  document.querySelectorAll('#propertiesTable tr[data-id]').forEach((row)=>row.addEventListener('click',()=>selectProperty(Number(row.dataset.id))));
  renderMapMarkers();
}

function initializeMap(){
  if(!window.L){
    el('propertyMap').innerHTML='<div class="map-error">המפה לא נטענה. נתוני הנכסים עדיין זמינים בטבלה.</div>';
    return;
  }
  state.map=window.L.map('propertyMap',{zoomControl:true,scrollWheelZoom:false}).setView([32.0486091,34.8650959],14);
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(state.map);
  state.markerLayer=window.L.markerClusterGroup?window.L.markerClusterGroup({
    chunkedLoading:true,maxClusterRadius:65,disableClusteringAtZoom:17,showCoverageOnHover:false,
    iconCreateFunction:(cluster)=>{
      const markers=cluster.getAllChildMarkers();
      const average=Math.round(markers.reduce((sum,marker)=>sum+(marker.options.dealScore||0),0)/markers.length);
      return window.L.divIcon({className:'cluster-marker-wrap',html:`<span class="deal-cluster" style="--marker-color:${scoreColor(average)}"><b>${markers.length}</b><small>${average}</small></span>`,iconSize:[52,52],iconAnchor:[26,26]});
    }
  }).addTo(state.map):window.L.layerGroup().addTo(state.map);
}

function renderMapMarkers(){
  if(!state.map||!state.markerLayer)return;
  state.markerLayer.clearLayers(); state.markers.clear();
  const points=[];
  for(const item of state.filtered){
    if(!Number.isFinite(item.latitude)||!Number.isFinite(item.longitude))continue;
    const score=item.analysis.scores.deal, approximate=item.address_confidence<.8;
    const icon=window.L.divIcon({className:'map-marker-wrap',html:`<span class="deal-map-marker ${approximate?'approximate':''}" style="--marker-color:${scoreColor(score)}">${score}</span>`,iconSize:[44,44],iconAnchor:[22,22],popupAnchor:[0,-22]});
    const marker=window.L.marker([item.latitude,item.longitude],{icon,dealScore:score,title:`${item.street||'נכס'}, ציון ${score}`,alt:`נכס ברחוב ${item.street||'לא ידוע'}, ציון ${score}`})
      .bindPopup(`<div class="map-popup"><strong>${escapeHtml(item.street||'נכס')} ${escapeHtml(item.house_number||'')}</strong><span>${money.format(item.asking_price)} · ${score}/100</span><small>${approximate?'מיקום משוער ברמת רחוב':'מיקום מאומת'}</small></div>`)
      .on('click',()=>selectProperty(item.id)).addTo(state.markerLayer);
    state.markers.set(item.id,marker); points.push([item.latitude,item.longitude]);
  }
  if(points.length===1)state.map.setView(points[0],15);
  else if(points.length>1)state.map.fitBounds(points,{padding:[35,35],maxZoom:15});
}

function selectProperty(id){
  state.selectedId=id; const item=state.all.find((x)=>x.id===id); if(!item)return;
  const a=item.analysis;
  el('detailPanel').innerHTML=`<div class="detail-content">
    <div class="detail-header"><div><p class="eyebrow">ניתוח נכס</p><h2>${escapeHtml(item.street||'נכס')} ${escapeHtml(item.house_number||'')}</h2><p>${escapeHtml(item.neighborhood||'')}, ${escapeHtml(item.city)}</p></div><div class="big-score">${a.scores.deal}</div></div>
    <div class="metric-grid">
      <div class="metric"><span>מקור המודעה</span><strong>${escapeHtml(sourceLabels[item.source]||item.source)}</strong></div>
      <div class="metric"><span>כיסוי מקביל</span><strong>${item.source_count>1?`${item.source_count} לוחות`:'לוח אחד'}</strong></div>
      <div class="metric"><span>מחיר מבוקש</span><strong>${money.format(item.asking_price)}</strong></div>
      <div class="metric"><span>מחיר למ״ר</span><strong>${a.pricePerSqm?money.format(a.pricePerSqm):'לא ידוע'}</strong></div>
      <div class="metric"><span>שכירות משוערת</span><strong>${money.format(a.estimatedMonthlyRent)}</strong></div>
      <div class="metric"><span>תשואה ברוטו</span><strong>${pct(a.grossYieldPct)}</strong></div>
      <div class="metric"><span>תשואה נטו</span><strong>${pct(a.netYieldPct)}</strong></div>
      <div class="metric"><span>מוטיבציית מוכר</span><strong>${a.scores.sellerMotivation}/100</strong></div>
      <div class="metric"><span>עסקאות אמת להשוואה</span><strong>${a.evidence?.transactionCount||0}</strong></div>
      <div class="metric"><span>בסיס הערכת השווי</span><strong>${a.evidence?.valuationMethod==='tax-transactions-price-per-sqm'?'רשות המסים':'הנחות POC'}</strong></div>
    </div>
    ${item.source_url?`<a class="source-link" href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">פתיחת המודעה במקור</a>`:''}
    <div id="govMapLink"><small>מכין קישור ל־GovMap...</small></div>
    <div class="match-card"><h3>התאמות בלוחות אחרים</h3><div id="crossSourceMatches" class="match-list"><small>בודק התאמות...</small></div></div>
    <div class="range-card"><h3>טווח משא ומתן</h3>
      <div class="price-line"><span>הצעת פתיחה</span><strong>${money.format(a.suggestedOpeningOffer)}</strong></div>
      <div class="price-line"><span>טווח יעד</span><strong>${money.format(a.targetAcquisition.low)} עד ${money.format(a.targetAcquisition.high)}</strong></div>
      <div class="price-line"><span>מחיר יציאה</span><strong>${money.format(a.walkAwayPrice)}</strong></div>
    </div>
    <div class="warning">רמת הביטחון היא ${a.evidenceLevel==='building-level'?'ברמת הבניין':'ברמת הרחוב בלבד'}. טווח השווי והציון הם כלי סינון, לא תחליף לאימות כתובת, מסמכים ושמאות.</div>
  </div>`;
  renderTable();
  const marker=state.markers.get(id);
  if(marker&&state.map){
    if(state.markerLayer.zoomToShowLayer)state.markerLayer.zoomToShowLayer(marker,()=>marker.openPopup());
    else{state.map.flyTo(marker.getLatLng(),16,{duration:.55});marker.openPopup()}
  }
  renderCharts(id,item);
  renderCrossSourceMatches(id);
  renderGovMapLink(id);
}

async function renderGovMapLink(id){
  const target=el('govMapLink');if(!target)return;
  try{const response=await fetch(`/api/v1/listings/${id}/govmap-link`),payload=await response.json();target.innerHTML=response.ok?`<a class="source-link" href="${escapeHtml(payload.data.url)}" target="_blank" rel="noopener noreferrer">אימות כתובת, גוש וחלקה ב־GovMap</a>`:'<small>לא ניתן ליצור קישור ל־GovMap.</small>'}catch{target.innerHTML='<small>לא ניתן ליצור קישור ל־GovMap.</small>'}
}

async function renderCrossSourceMatches(id){
  const target=el('crossSourceMatches'); if(!target)return;
  try{
    const response=await fetch(`/api/v1/listings/${id}/cross-source-candidates`); if(!response.ok)throw new Error('הבדיקה נכשלה');
    const {data}=await response.json();
    if(!data.length){target.innerHTML='<small>לא נמצאה כרגע התאמה מספקת בלוח אחר.</small>';return}
    target.innerHTML=data.map((match)=>`<a href="${escapeHtml(match.source_url||'#')}" ${match.source_url?'target="_blank" rel="noopener noreferrer"':''} class="match-row">
      <span><b>${escapeHtml(sourceLabels[match.source]||match.source)}</b><small>${escapeHtml(match.street||match.neighborhood||match.city)} · ${money.format(match.asking_price)}</small></span>
      <strong>${match.match_score}%<small>${match.status==='confirmed'?'מאומתת':match.status==='probable'?'סבירה':'אפשרית'}</small></strong>
    </a>`).join('');
  }catch(error){target.innerHTML=`<small>${escapeHtml(error.message)}</small>`}
}

function chartEmpty(message){return `<div class="chart-empty">${escapeHtml(message)}</div>`}

function lineChart(data){
  if(data.length<2)return chartEmpty('עדיין אין מספיק תצפיות להצגת מגמה');
  const width=640,height=235,pad={top:30,right:24,bottom:45,left:72};
  const values=data.map((d)=>d.value),min=Math.min(...values),max=Math.max(...values),range=Math.max(max-min,1),floor=min-range*.18,ceiling=max+range*.18;
  const x=(i)=>pad.left+i*(width-pad.left-pad.right)/(data.length-1),y=(value)=>pad.top+(ceiling-value)/(ceiling-floor)*(height-pad.top-pad.bottom);
  const points=data.map((d,i)=>`${x(i)},${y(d.value)}`).join(' ');
  const grid=[0,.5,1].map((ratio)=>{const value=ceiling-(ceiling-floor)*ratio,yy=pad.top+(height-pad.top-pad.bottom)*ratio;return `<line x1="${pad.left}" y1="${yy}" x2="${width-pad.right}" y2="${yy}" class="chart-gridline"/><text x="${pad.left-9}" y="${yy+4}" text-anchor="end" class="chart-axis">${Math.round(value/1000)}K</text>`}).join('');
  const labels=data.map((d,i)=>`<text x="${x(i)}" y="${height-16}" text-anchor="middle" class="chart-axis">${escapeHtml(d.label)}</text><circle cx="${x(i)}" cy="${y(d.value)}" r="5" class="chart-dot"/><text x="${x(i)}" y="${y(d.value)-12}" text-anchor="middle" class="chart-value">${Math.round(d.value/1000)}K</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="גרף קו של היסטוריית המחיר">${grid}<polyline points="${points}" class="chart-line"/>${labels}</svg>`;
}

function barChart(data,{suffix='',currency=false}={}){
  if(!data.length)return chartEmpty('אין עדיין נתונים להשוואה');
  const width=640,row=52,height=Math.max(180,data.length*row+42),labelWidth=155,max=Math.max(...data.map((d)=>d.value),1);
  const bars=data.map((d,i)=>{const y=22+i*row,barWidth=(width-labelWidth-75)*d.value/max,value=currency?money.format(d.value):`${Number(d.value).toFixed(2)}${suffix}`;return `<text x="${labelWidth-10}" y="${y+21}" text-anchor="end" class="chart-axis chart-label">${escapeHtml(d.label)}</text><rect x="${labelWidth}" y="${y}" width="${barWidth}" height="28" rx="7" class="chart-bar"/><text x="${Math.min(labelWidth+barWidth+9,width-6)}" y="${y+20}" class="chart-value">${escapeHtml(value)}</text>`}).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="גרף עמודות להשוואת נתונים">${bars}</svg>`;
}

async function renderCharts(id,item){
  el('chartsTitle').textContent=`גרפים: ${item.street||'נכס'} ${item.house_number||''}`;
  ['priceChart','rentChart','transactionChart','yieldChart'].forEach((chartId)=>el(chartId).innerHTML=chartEmpty('טוען נתונים...'));
  try{
    const response=await fetch(`/api/v1/listings/${id}/charts`); if(!response.ok)throw new Error('טעינת הגרפים נכשלה');
    const {data}=await response.json();
    const history=data.priceHistory.map((point)=>({label:new Date(point.observed_at).toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit'}),value:point.price}));
    const rents=data.rentalComps.map((comp)=>({label:`${comp.rooms||'?'} חד׳ · ${comp.area_sqm||'?'} מ״ר`,value:comp.asking_price}));
    const transactions=data.transactionComps.map((comp)=>({label:`${new Date(comp.transaction_date).toLocaleDateString('he-IL',{month:'2-digit',year:'2-digit'})} · ${comp.area_sqm||'?'} מ״ר`,value:comp.price}));
    el('priceChart').innerHTML=lineChart(history);
    el('rentChart').innerHTML=barChart(rents,{currency:true});
    el('transactionChart').innerHTML=barChart(transactions,{currency:true});
    el('yieldChart').innerHTML=barChart(data.yields,{suffix:'%'});
  }catch(error){['priceChart','rentChart','transactionChart','yieldChart'].forEach((chartId)=>el(chartId).innerHTML=chartEmpty(error.message))}
}

['searchInput','scoreFilter','sourceFilter'].forEach((id)=>el(id).addEventListener(id==='searchInput'?'input':'change',applyFilters));
el('refreshButton').addEventListener('click',loadDashboard);

el('marketplaceOcrButton').addEventListener('click',async()=>{
  const form=el('marketplaceForm'),file=form.elements.screenshot.files[0],status=el('marketplaceStatus'),button=el('marketplaceOcrButton');
  if(!file){status.className='error';status.textContent='יש לבחור צילום מסך לפני הפענוח.';return}
  if(!window.Tesseract){status.className='error';status.textContent='רכיב ה־OCR לא נטען.';return}
  button.disabled=true;status.className='';status.textContent='מפענח את צילום המסך...';
  try{
    const result=await window.Tesseract.recognize(file,'heb+eng',{logger:(progress)=>{if(progress.status==='recognizing text')status.textContent=`מפענח צילום: ${Math.round(progress.progress*100)}%`}});
    const response=await fetch('/api/v1/marketplace-ocr/parse',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:result.data.text})}),payload=await response.json();
    if(!response.ok)throw new Error('פענוח הטקסט נכשל');const detected=payload.data;
    for(const key of ['city','price','rooms','areaSqm','floor','street','houseNumber'])if(detected[key]!=null)form.elements[key].value=detected[key];
    if(detected.text&&!form.elements.description.value)form.elements.description.value=detected.text.slice(0,1200);
    const count=['city','price','rooms','areaSqm','floor','street','houseNumber'].filter((key)=>detected[key]!=null).length;
    status.className=count?'success':'error';status.textContent=count?`זוהו ${count} שדות. יש לבדוק אותם לפני השמירה.`:'לא זוהו שדות בצורה מספקת. אפשר להזין ידנית.';
  }catch(error){status.className='error';status.textContent=error.message}
  finally{button.disabled=false}
});

async function fileToDataUrl(file){
  if(!file)return null;
  if(file.size>2_000_000)throw new Error('צילום המסך גדול מ־2MB');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('קריאת התמונה נכשלה'));reader.readAsDataURL(file)});
}

async function loadMarketplaceInbox(){
  try{
    const response=await fetch('/api/v1/marketplace-inbox?limit=5');if(!response.ok)return;
    const {data}=await response.json();
    el('marketplaceRecent').innerHTML=data.length?data.map((item)=>`<div class="marketplace-row"><span><b>${escapeHtml(item.street||item.neighborhood||item.city)}</b> · ${money.format(item.asking_price)}${item.has_screenshot?' · צילום נשמר':''}</span><small>${item.listing_type==='rent'?'השכרה':'מכירה'}</small></div>`).join(''):'';
  }catch{}
}

el('marketplaceForm').addEventListener('submit',async(event)=>{
  event.preventDefault();const form=event.currentTarget,status=el('marketplaceStatus'),button=form.querySelector('button[type="submit"]');
  status.className='';status.textContent='שומר ובודק התאמות...';button.disabled=true;
  try{
    const values=Object.fromEntries(new FormData(form).entries()),file=form.elements.screenshot.files[0];delete values.screenshot;
    for(const key of ['price','rooms','areaSqm','floor'])values[key]=values[key]===''?null:Number(values[key]);
    values.screenshotDataUrl=await fileToDataUrl(file);
    const response=await fetch('/api/v1/marketplace-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)}),payload=await response.json();
    if(!response.ok)throw new Error(payload.message||'שמירת המודעה נכשלה');
    const matches=payload.data.matches.length;status.className='success';status.textContent=`המודעה נשמרה. נמצאו ${matches} התאמות אפשריות בלוחות אחרים.`;
    form.reset();await loadDashboard();
  }catch(error){status.className='error';status.textContent=error.message}
  finally{button.disabled=false}
});

el('transactionImportForm').addEventListener('submit',async(event)=>{
  event.preventDefault();const form=event.currentTarget,status=el('transactionImportStatus'),button=form.querySelector('button');status.className='';status.textContent='מייבא ומאמת...';button.disabled=true;
  try{
    const transactions=JSON.parse(form.elements.transactions.value);if(!Array.isArray(transactions))throw new Error('יש להדביק מערך JSON');
    const response=await fetch('/api/v1/transactions/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'tax-authority-import',transactions})}),payload=await response.json();
    if(!response.ok)throw new Error(payload.message||'ייבוא העסקאות נכשל');status.className='success';status.textContent=`יובאו ${payload.data.imported} עסקאות. הערכות השווי חושבו מחדש.`;form.reset();await loadDashboard();
  }catch(error){status.className='error';status.textContent=error.message}finally{button.disabled=false}
});

el('govMapEvidenceForm').addEventListener('submit',async(event)=>{
  event.preventDefault();const form=event.currentTarget,status=el('govMapEvidenceStatus'),button=form.querySelector('button');
  if(!state.selectedId){status.className='error';status.textContent='יש לבחור קודם נכס בטבלה.';return}
  status.className='';status.textContent='שומר ראיה...';button.disabled=true;
  try{
    const values=Object.fromEntries(new FormData(form).entries());for(const key of ['latitude','longitude','confidence'])values[key]=values[key]===''?null:Number(values[key]);values.listingId=state.selectedId;
    const response=await fetch('/api/v1/govmap/evidence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)}),payload=await response.json();if(!response.ok)throw new Error(payload.message||'שמירת הראיה נכשלה');
    status.className='success';status.textContent='הכתובת והגוש/חלקה נשמרו עם מקור ורמת ביטחון.';form.reset();await loadDashboard();
  }catch(error){status.className='error';status.textContent=error.message}finally{button.disabled=false}
});
initializeMap();
loadDashboard();
