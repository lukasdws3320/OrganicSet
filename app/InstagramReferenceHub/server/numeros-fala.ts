/** Renderização de fala PT-BR; fonte e timestamps permanecem literais. */
const unidades=['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez','onze','doze','treze','catorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
const dezenas=['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
const centenas=['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
function inteiro(n:number):string {
 if(n<20)return unidades[n];
 if(n<100)return dezenas[Math.floor(n/10)]+(n%10?' e '+inteiro(n%10):'');
 if(n===100)return 'cem';
 if(n<1000)return centenas[Math.floor(n/100)]+(n%100?' e '+inteiro(n%100):'');
 const escala=n<1e6?1000:n<1e9?1e6:1e9;
 const q=Math.floor(n/escala),resto=n%escala;
 const prefixo=escala===1000?(q===1?'mil':inteiro(q)+' mil'):inteiro(q)+(escala===1e6?(q===1?' milhão':' milhões'):(q===1?' bilhão':' bilhões'));
 return prefixo+(resto?(resto<100||resto%100===0?' e ':' ')+inteiro(resto):'');
}
const feminino=/^(?:colher(?:es)?|xícara(?:s)?|chávena(?:s)?|pitada(?:s)?|gota(?:s)?|porç(?:ão|ões)|fatia(?:s)?|banana(?:s)?|batata(?:s)?|cenoura(?:s)?|cebola(?:s)?|pessoa(?:s)?|receita(?:s)?|vez(?:es)?|hora(?:s)?|semana(?:s)?|lata(?:s)?|garrafa(?:s)?|tigela(?:s)?|forma(?:s)?|gema(?:s)?|clara(?:s)?|maçã(?:s)?|laranja(?:s)?|abobrinha(?:s)?|berinjela(?:s)?|folha(?:s)?|cabeça(?:s)?|unidade(?:s)?|mão(?:s)?|mãos|dose(?:s)?|medida(?:s)?)\b/iu;
const masculino=/^(?:ovo(?:s)?|copo(?:s)?|litro(?:s)?|mililitro(?:s)?|grama(?:s)?|quilograma(?:s)?|quilo(?:s)?|minuto(?:s)?|segundo(?:s)?|dia(?:s)?|mês|meses|ano(?:s)?|dente(?:s)?|pedaço(?:s)?|punhado(?:s)?|grau(?:s)?)\b/iu;
function genero(resto:string):boolean|undefined {
 const alvo=resto.replace(/^\s*(?:a|até)\s+(?:\d+|três|quatro|cinco|seis|sete|oito|nove|dez)\s+/iu,'').trimStart();
 return feminino.test(alvo)?true:masculino.test(alvo)?false:undefined;
}
function concordar(s:string,f:boolean|undefined){return f===undefined?s:s.replace(/\b(um|uma|dois|duas|duzentos|duzentas|trezentos|trezentas|quatrocentos|quatrocentas|quinhentos|quinhentas|seiscentos|seiscentas|setecentos|setecentas|oitocentos|oitocentas|novecentos|novecentas)\b/giu,w=>{let x=w.toLowerCase();if(f)x=x==='um'?'uma':x==='dois'?'duas':x.replace(/os$/,'as');else x=x==='uma'?'um':x==='duas'?'dois':x.replace(/as$/,'os');return /^[A-ZÁÉÍÓÚ]/.test(w)?x[0].toUpperCase()+x.slice(1):x;});}
export function numerosPorExtenso(texto:string):string {
 let t=texto.replace(/\b(\d+)\.(\d{1,2})\b/g,'$1,$2').replace(/R\$\s*(\d+(?:\.\d{3})*)(?:,(\d{2}))?/g,(_,a,b)=>{const n=Number(a.replace(/\./g,'')),c=Number(b||0);return inteiro(n)+(n===1?' real':' reais')+(c?' e '+inteiro(c)+(c===1?' centavo':' centavos'):'');});
 t=t.replace(/(\d+(?:[,.]\d+)?)\s*(kg|ml|g|l)\b/gi,(_,n,u)=>n+' '+({kg:'quilogramas',ml:'mililitros',g:'gramas',l:'litros'} as Record<string,string>)[u.toLowerCase()]);
 // Medidas de receita: metade é pronunciada depois da unidade, sem leitura decimal.
 const medidas:Record<string,string>={litros:'litro',mililitros:'mililitro',gramas:'grama',quilogramas:'quilograma',quilos:'quilo',xícaras:'xícara',colheres:'colher',copos:'copo',horas:'hora',minutos:'minuto',segundos:'segundo'};
 t=t.replace(/\b(\d+),50?\s+(litros?|mililitros?|gramas?|quilogramas?|quilos?|xícaras?|colher(?:es)?|copos?|horas?|minutos?|segundos?)\b/giu,(_,a,u)=>{
  const n=Number(a),unit=u.toLowerCase(),singular=medidas[unit]??unit,f=genero(singular),metade=f?'meia':'meio';
  return n===0?metade+' '+singular:concordar(inteiro(n),f)+' '+(n===1?singular:unit)+' e '+metade;
 });
 t=t.replace(/(\d+)\s*°\s*([CF])\b/g,(_,n,u)=>inteiro(Number(n))+' graus'+(u==='C'?'':' Fahrenheit'));
 t=t.replace(/\bgraus\s+Celsius\b/gi,'graus');
 t=t.replace(/(\d+(?:[,.]\d+)?)\s*%/g,(_,n)=>n+' por cento');
 t=t.replace(/½|¼|¾/g,x=>({'½':'1/2','¼':'1/4','¾':'3/4'}[x]!));
 t=t.replace(/\b(\d+)\/(\d+)\b/g,(m,a,b,off,str)=>a==='1'&&b==='2'?(genero(str.slice(off+m.length))===false?'meio':'meia'):b==='4'?inteiro(Number(a))+(a==='1'?' quarto':' quartos'):b==='3'?inteiro(Number(a))+(a==='1'?' terço':' terços'):({'5':'quinto','6':'sexto','7':'sétimo','8':'oitavo','9':'nono','10':'décimo'} as Record<string,string>)[b]?inteiro(Number(a))+' '+({'5':'quinto','6':'sexto','7':'sétimo','8':'oitavo','9':'nono','10':'décimo'} as Record<string,string>)[b]+(a==='1'?'':'s'):inteiro(Number(a))+' sobre '+inteiro(Number(b)));
 t=t.replace(/\b\d+(?:\.\d{3})*(?:,\d+)?\b/g,(m,off,str)=>{const [a,b]=m.split(',');const n=Number(a.replace(/\./g,''));if(!Number.isSafeInteger(n)||n>=1e12)return m;const f=genero(str.slice(off+m.length));return concordar(inteiro(n),f)+(b?' vírgula '+b.split('').map(x=>unidades[Number(x)]).join(' '):'');});
 // Corrigir concordância evidente também quando o ASR já escreveu por extenso.
 t=t.replace(/\b(um|uma|dois|duas|duzentos|duzentas|trezentos|trezentas|quatrocentos|quatrocentas|quinhentos|quinhentas|seiscentos|seiscentas|setecentos|setecentas|oitocentos|oitocentas|novecentos|novecentas)\b/giu,(m,_word,off,str)=>concordar(m,genero(str.slice(off+m.length))));
 return t;
}
