(() => {
  const ids = ["dealName","purchasePrice","sites","gallons","fuelMargin","insideSales","insideMargin","sellerEbitda","commission","rent","retainedCosts","synergies","conversionCapex","passcode","notes"];
  const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const money = value => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value)||0);
  const n = id => Number(el[id].value)||0;
  function model() {
    const fuelGrossProfit=n("gallons")*n("fuelMargin");
    const insideGrossProfit=n("insideSales")*(n("insideMargin")/100);
    const sunocoEbitda=fuelGrossProfit+n("rent")+n("synergies")-n("commission")-n("retainedCosts");
    const combinedUplift=fuelGrossProfit+insideGrossProfit+n("synergies")-n("retainedCosts")-n("sellerEbitda");
    const invested=n("purchasePrice")+n("conversionCapex");
    const multiple=sunocoEbitda>0?n("purchasePrice")/sunocoEbitda:null;
    document.getElementById("mFuel").textContent=money(fuelGrossProfit);
    document.getElementById("mInside").textContent=money(insideGrossProfit);
    document.getElementById("mSunoco").textContent=money(sunocoEbitda);
    document.getElementById("mUplift").textContent=money(combinedUplift);
    document.getElementById("mMultiple").textContent=multiple?multiple.toFixed(1)+"x":"n/a";
    document.getElementById("mInvested").textContent=money(invested);
    return {fuelGrossProfit,insideGrossProfit,sunocoAfterConversionEbitda:sunocoEbitda,combinedRecurringUplift:combinedUplift,totalInvestedCapital:invested,purchaseMultiple:multiple};
  }
  document.getElementById("calculate").addEventListener("click",model);
  document.getElementById("file").addEventListener("change",async event=>{
    const file=event.target.files[0]; if(!file)return;
    try{const text=await file.text(); el.notes.value+=(el.notes.value?"\n\n":"")+"--- "+file.name+" ---\n"+text.slice(0,120000); document.getElementById("status").textContent=file.name+" loaded."}
    catch{document.getElementById("status").textContent="Could not read that file. Export spreadsheets as CSV first."}
  });
  document.getElementById("analyze").addEventListener("click",async()=>{
    const button=document.getElementById("analyze"),status=document.getElementById("status"),output=document.getElementById("analysis");
    button.disabled=true; status.textContent="Analyzing deal..."; output.textContent="Working through economics, missing fields, risks, and synergy opportunities...";
    const inputs=Object.fromEntries(ids.filter(id=>id!=="passcode").map(id=>[id,el[id].value]));
    try{
      const response=await fetch("/api/deal-desk/analyze",{method:"POST",headers:{"content-type":"application/json","x-deal-desk-passcode":el.passcode.value},body:JSON.stringify({inputs,model:model()})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.message||"Analysis failed.");
      output.textContent=data.analysis; status.textContent="Analysis complete.";
    }catch(error){output.textContent="Analysis unavailable: "+error.message;status.textContent="Check the configuration and try again."}
    finally{button.disabled=false}
  });
  model();
})();
