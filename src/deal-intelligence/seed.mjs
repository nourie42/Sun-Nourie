export function initialState() {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const exampleFinancials = {
    siteCount: 18, annualGallonsPerSite: 1300000, fuelMarginCPG: 20,
    merchandiseRevenuePerSite: 1200000, merchandiseMarginPercent: 30,
    otherProfitPerSite: 15000, opexPerSite: 420000,
    sustainingCapexPerSite: 35000, purchasePrice: 42000000,
    realEstateValue: 12000000, transactionCostPercent: 2,
    growthPercent: 2, terminalMultiple: 7, targetYieldPercent: 15, targetIrrPercent: 15,
    years: 10, structure: 'COOP',
  };
  const profiles = [
    ['sample-a', 'Regional operator A', 'NC', 18, 'Research', 88, 'High', 'Watch', 'Validate legal ownership and site count.'],
    ['sample-b', 'Family operator B', 'VA', 11, 'Ready to contact', 82, 'Medium', 'Unknown', 'Prepare introductory owner questions.'],
    ['sample-c', 'Independent marketer C', 'SC', 27, 'Contacted', 79, 'Medium', 'Unknown', 'Complete the wholesale / retail split.'],
    ['sample-d', 'Retail portfolio D', 'TN', 8, 'NDA', 85, 'High', 'Watch', 'Review operating statements and leases.'],
    ['sample-e', 'Fuel distributor E', 'GA', 35, 'Diligence', 91, 'High', 'Strong', 'Reconcile normalized EBITDA to site records.'],
    ['sample-f', 'Convenience group F', 'FL', 14, 'Research', 73, 'Low', 'Unknown', 'Confirm whether locations are owned or leased.'],
  ];
  const targets = profiles.map(([id, name, state, siteCount, stage, score, confidence, sellerSignal, nextAction]) => ({
    id, name, legalName: '', type: id === 'sample-e' ? 'Fuel distributor' : 'Convenience retailer',
    states: [state], siteCount, ownerName: '', ownerTitle: '', contactEmail: '', contactPhone: '',
    stage, score, confidence, sellerSignal,
    sellerSignalReason: 'Illustrative workflow example. Seller interest has not been established.',
    sourceUrls: [], sources: [], notes: 'Sample record for exploring the workspace. This is not a researched company or an acquisition recommendation.',
    nextAction, dueDate: today, sample: true,
    financials: { ...exampleFinancials, siteCount, purchasePrice: siteCount * 2333333, realEstateValue: siteCount * 666667 },
    createdAt: now, updatedAt: now,
  }));
  return {
    schemaVersion: 1, sampleMode: true, updatedAt: now, targets,
    sites: [
      ['site-a1','sample-a','Example location 01','Charlotte','NC',35.23,-80.84],
      ['site-a2','sample-a','Example location 02','Greensboro','NC',36.07,-79.79],
      ['site-b1','sample-b','Example location 03','Richmond','VA',37.54,-77.44],
      ['site-c1','sample-c','Example location 04','Columbia','SC',34,-81.03],
      ['site-d1','sample-d','Example location 05','Knoxville','TN',35.96,-83.92],
      ['site-e1','sample-e','Example location 06','Atlanta','GA',33.75,-84.39],
      ['site-f1','sample-f','Example location 07','Jacksonville','FL',30.33,-81.66],
    ].map(([id,targetId,address,city,state,latitude,longitude])=>({id,targetId,address,city,state,latitude,longitude,fuelBrand:'Unverified',ownership:'Unknown',annualGallons:1300000,notes:'Sample approximate city location. Address and site economics are illustrative.',sample:true})),
    signals: [
      {id:'signal-a',targetId:'sample-a',title:'Ownership research needs attention',detail:'Example signal: an ownership change would require reviewing legal entities and transfer records before outreach.',date:today,sourceUrl:'',confidence:'Low',sample:true},
      {id:'signal-e',targetId:'sample-e',title:'Operating data awaiting verification',detail:'Example signal: reconcile reported fuel gallons, margins, rent and sustaining capital expenditure.',date:today,sourceUrl:'',confidence:'Medium',sample:true},
    ],
    tasks: [
      {id:'task-a',targetId:'sample-a',title:'Confirm legal owner and beneficial control',dueDate:today,done:false,sample:true},
      {id:'task-d',targetId:'sample-d',title:'Request a site-level lease and tank schedule',dueDate:today,done:false,sample:true},
      {id:'task-e',targetId:'sample-e',title:'Reconcile underwriting assumptions',dueDate:today,done:false,sample:true},
    ],
    notes: [], documents: [],
    settings: {workspaceName:'My M&A workspace',targetStates:['NC','SC','VA'],minSites:5,maxSites:35,targetYieldPercent:15,targetIrrPercent:15,watchTerms:'ownership, site closures, expansion, environmental records',currency:'USD'},
  };
}
