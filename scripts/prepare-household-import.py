"""Prepare a private import from complete Finances row CSVs; no network or writes to a repo.
Retrieve linked-account coverage first. The first transaction query must retrieve all
posted inflows (amount < 0, include_transfers=true, no category filter). Then retrieve
all signed posted activity and pending activity for the same accounts/date range.
Do not provide the separate inflow-candidate CSV again: it duplicates the signed file.

Usage: python scripts/prepare-household-import.py --posted posted.csv --pending pending.csv
 --as-of YYYY-MM-DD --start YYYY-MM-DD --end YYYY-MM-DD --out payload.private.json
 --coverage-note 'Available synced accounts; freshness unknown' [--pending-complete]
Additional CSV pages may repeat --posted or --pending. Inline tool rows can be
serialized locally with the same column names. Never upload plaintext output.
"""
import argparse,csv,hashlib,json,datetime
from decimal import Decimal,ROUND_HALF_UP
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--posted',action='append',required=True);p.add_argument('--pending',action='append',default=[])
for name in ['as-of','start','end','out','coverage-note']:p.add_argument('--'+name,required=True)
p.add_argument('--pending-complete',action='store_true')
a=p.parse_args()
for value in [a.as_of,a.start,a.end]:datetime.date.fromisoformat(value)
if not a.start<=a.end<=a.as_of:raise ValueError('Date range must end on or before the report date.')
def ident(value):return hashlib.sha256(str(value).encode()).hexdigest()[:24]
def cents(value):return int((Decimal(str(value))*100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
by_id={};accounts=set()
for pending,files in [(False,a.posted),(True,a.pending)]:
 for file in files:
  with open(file,newline='',encoding='utf-8-sig') as f:
   reader=csv.DictReader(f)
   required={'transaction_id','date','amount','account_name'}
   if not required.issubset(reader.fieldnames or []):raise ValueError('Need row-level records with transaction IDs, dates, amounts and account names; aggregated data cannot be imported.')
   for r in reader:
    if not r['transaction_id']:raise ValueError('A transaction ID is missing.')
    if r.get('iso_currency_code') not in (None,'','USD'):raise ValueError('Non-USD activity needs separate currency handling.')
    date=r['date'][:10];datetime.date.fromisoformat(date)
    if not a.start<=date<=a.end:raise ValueError('A row lies outside the requested coverage range.')
    category=r.get('personal_finance_category_detailed') or ''
    t={'id':ident(r['transaction_id']),'date':date,'amount':cents(r['amount']),
       'account':r['account_name'],'name':r.get('name') or r.get('merchant_name') or 'Unidentified transaction',
       'merchant':r.get('merchant_name') or r.get('name') or 'Unidentified transaction',
       'pending':pending,'category':category,'confidence':r.get('personal_finance_category_confidence_level') or '',
       'link':ident(r['transfer_transaction_id']) if r.get('transfer_transaction_id') else ''}
    if r.get('pending_transaction_id'):t['pendingId']=ident(r['pending_transaction_id'])
    existing=by_id.get(t['id'])
    if existing and existing!=t:raise ValueError('Conflicting duplicate IDs; reconcile posted/pending source rows before import.')
    by_id[t['id']]=t;accounts.add(t['account'])
rows=sorted(by_id.values(),key=lambda r:(r['date'],r['id']))
posted=[r for r in rows if not r['pending']]
if not posted:raise ValueError('No posted records found; do not publish an empty replacement.')
source={'asOf':a.as_of,'postedThrough':max(r['date'] for r in posted),
        'observedThrough':max(r['date'] for r in rows),'freshness':'unknown',
        'coverage':a.coverage_note,'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
payload={'version':1,'kind':'transactions','id':hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest(),
         'source':source,'period':{'start':a.start,'end':a.end},'coveredAccounts':sorted(accounts),
         'pendingComplete':a.pending_complete,'transactions':rows}
Path(a.out).write_text(json.dumps(payload,separators=(',',':')),encoding='utf-8')
print(f'Prepared {len(rows)} private records. Encrypt before any upload. Budgets and manual edits are not included.')
