export type SourceFile = {
 id:string; name:string; kind:'text'|'pdf'|'image'|'doc'|'rtf'; text:string;
 mediaType?:string; data?:string; pages?:number; warnings:string[]; children?:SourceFile[];
 sites?:Site[]; workbook?:Array<{name:string; cells:Record<string,{value:any;formula?:string}>}>;
};
export type Site = {
 id:string; name?:string; address?:string; city?:string; state?:string; zip?:string;
 ownership?:string; brand?:string; period?:string; sourceId:string; locator:string;
 gallons?:number; fuelCpg?:number; insideGp?:number; sellerOpex?:number;
 raw:Record<string,any>; duplicate?:boolean; reviewRequired?:boolean;
};
export type Evidence = {
 field:string; value:number|null; sourceId:string; locator:string; quote:string;
 period:string; sourceUnit:string; status:string; reason:string; confidence?:string;
};
export type Review = {
 deal:any; company:any; summary:string; evidence:Evidence[]; sites:Site[];
 warnings:string[]; opportunities:any[]; sources:any[]; verified:boolean;
 conflicts:any[]; missing:string[]; generatedAt:string; searchUsed?:boolean;
};
