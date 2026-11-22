// RTMPose-M body7: affine crop, BGR normalization, SimCC decoding.
// The BGR channel order intentionally matches rtmlib 0.0.15's OpenCV pipeline.
export function geometry(roi) {
  const [x1,y1,x2,y2]=roi;
  if(!roi.every(Number.isFinite)||x2<=x1||y2<=y1)throw Error('請選擇有效的嬰幼兒範圍');
  let w=(x2-x1)*1.25,h=(y2-y1)*1.25;
  if(w>h*.75)h=w/.75;else w=h*.75;
  return {center:[(x1+x2)/2,(y1+y2)/2],scale:[w,h]};
}
export function preprocess(pixels,width,height,roi) {
  const {center,scale}=geometry(roi),input=new Float32Array(3*192*256);
  const m=[123.675,116.28,103.53],s=[58.395,57.12,57.375];
  for(let y=0;y<256;y++)for(let x=0;x<192;x++) {
    // Continuous inverse affine with bilinear interpolation (OpenCV 5.1 reference).
    const qx=x/192*scale[0]+center[0]-scale[0]/2;
    const qy=y/256*scale[1]+center[1]-scale[1]/2;
    const ix=Math.floor(qx),iy=Math.floor(qy),fx=qx-ix,fy=qy-iy;
    for(let c=0;c<3;c++) {
      let value=0;
      for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++) {
        const px=ix+dx,py=iy+dy;
        if(px>=0&&px<width&&py>=0&&py<height)value+=pixels[(py*width+px)*4+2-c]*(dx?fx:1-fx)*(dy?fy:1-fy);
      }
      input[c*192*256+y*192+x]=(Math.floor(value+.5)-m[c])/s[c];
    }
  }
  return input;
}
export function decode(xData,yData,roi,width,height) {
  if(xData.length!==17*384||yData.length!==17*512)throw Error('模型輸出需為 COCO 17 點 SimCC 384/512');
  const {center,scale}=geometry(roi),xy=[],scores=[];
  for(let j=0;j<17;j++) {
    let xi=0,yi=0,xmax=-Infinity,ymax=-Infinity;
    for(let k=0;k<384;k++)if(xData[j*384+k]>xmax){xmax=xData[j*384+k];xi=k;}
    for(let k=0;k<512;k++)if(yData[j*512+k]>ymax){ymax=yData[j*512+k];yi=k;}
    let score=(xmax+ymax)/2;
    if(score<=0){xi=-1;yi=-1;}
    const x=xi/2/192*scale[0]+center[0]-scale[0]/2,y=yi/2/256*scale[1]+center[1]-scale[1]/2;
    if(x<0||x>=width||y<0||y>=height||!Number.isFinite(score))score=0;
    xy.push([x,y]);scores.push(score);
  }
  return {xy,scores};
}
