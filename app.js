import {
  auth, db, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updatePassword,
  doc, setDoc, getDoc, updateDoc, addDoc, getDocs, collection, query, where, serverTimestamp, orderBy
} from './firebase.js';


// ---- Helpers ----
const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => (Number(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayISO = () => new Date().toISOString().slice(0,10);

// Converte "AAAA-MM-DD" para "DD/MM/AAAA"
const brFromISO = (iso) => {
  if (!iso) return '';
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  if (iso?.toDate) return iso.toDate().toLocaleDateString('pt-BR');
  if (iso instanceof Date) return iso.toLocaleDateString('pt-BR');
  return String(iso);
};

function printThermalReceipt(data) {
  const win = window.open('', '_blank', 'width=400,height=800');
  const now = new Date();
  const dt = now.toLocaleString('pt-BR');

  const dataCaixaBR = brFromISO(data.dataCaixa);

  const html = `<!DOCTYPE html>
  <html><head><meta charset="utf-8">
  <title>Recibo</title>
  <style>
    @page { size: 80mm 148mm; margin: 0mm; }
    body { font-family: "Lucida Sans", Courier, monospace; font-size: 12px; margin: 0; padding: 0; }
    h1 { text-align: center; font-size: 15px; margin: 8px 0 12px; margin-left: -25px; }
    .mono { font-family: "Lucida Sans", monospace; white-space: pre-wrap; }
  </style></head>
  <body onload="window.print(); setTimeout(()=>window.close(), 500);">

    <h1>RECIBO DE PAGAMENTO MANUAL</h1>
--------------------------------------------------------------------
    <div class="mono">
  <strong>Matricula Motorista:</strong> ${data.matriculaMotorista}<br>
  <strong>Tipo de Validador:</strong> ${data.tipoValidador}<br>
  <strong>Prefixo:</strong> ${data.prefixo}<br>
--------------------------------------------------------------------
  <strong>Data do Caixa:</strong> ${dataCaixaBR}<br>  
  <strong>Quantidade bordos:</strong> ${data.qtdBordos}<br>
  <strong>Valor:</strong> R$ ${Number(data.valor).toFixed(2)}<br> 
--------------------------------------------------------------------
  <strong>Matricula Recebedor:</strong> ${data.matriculaRecebedor}<br>
  <strong>Data Recebimento:</strong> ${dt}<br><br>
  <strong>Assinatura Recebedor:</strong><br>


         ________________________________
    </div>

  </body></html>`;

  win.document.write(html);
  win.document.close();
}

async function gerarRelatorioPDF() {
  const { jsPDF } = window.jspdf;
  const docpdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const uid = currentCaixaRef.userId;
  const cid = currentCaixaRef.caixaId;

  const logo = new Image();
  logo.src = "./assets/logo.png";

  logo.onload = async () => {
    const pageWidth = docpdf.internal.pageSize.getWidth();
    const logoWidth = 120;
    const logoHeight = 60;
    const logoX = (pageWidth - logoWidth) / 2;

    docpdf.addImage(logo, 'PNG', logoX, 30, logoWidth, logoHeight);

    // Linha separadora
    docpdf.setDrawColor(0, 128, 0);
    docpdf.setLineWidth(1.2);
    docpdf.line(40, 100, pageWidth - 40, 100);

    // === Cabeçalho ===
    let y = 120;
    docpdf.setFont('helvetica','bold');
    docpdf.setFontSize(16);
    docpdf.text('Relatório de Fechamento de Caixa', pageWidth / 2, y, { align: 'center' });
    y += 30;

    docpdf.setFontSize(11);
    docpdf.setFont('helvetica','normal');
    const hoje = new Date();
    const dataHoraBR = hoje.toLocaleDateString('pt-BR') + " " + hoje.toLocaleTimeString('pt-BR');

    // Pega dados do caixa (abertura / fechamento)
    const caixaSnap = await getDoc(doc(db, 'users', uid, 'caixas', cid));
    const caixaData = caixaSnap.data();
    let aberturaTxt = "", fechamentoTxt = dataHoraBR;

    if (caixaData?.createdAt?.toDate) {
      aberturaTxt = caixaData.createdAt.toDate().toLocaleDateString("pt-BR") + " " + caixaData.createdAt.toDate().toLocaleTimeString("pt-BR");
    }
    if (caixaData?.closedAt?.toDate) {
      fechamentoTxt = caixaData.closedAt.toDate().toLocaleDateString("pt-BR") + " " + caixaData.closedAt.toDate().toLocaleTimeString("pt-BR");
    }

    docpdf.text(`Operador: ${currentUserDoc.nome}  • Matrícula: ${currentUserDoc.matricula}`, 40, y); y += 16;
    if (aberturaTxt) {
      docpdf.text(`Abertura do caixa: ${aberturaTxt}`, 40, y); y += 16;
    }
    docpdf.text(`Data do fechamento: ${fechamentoTxt}`, 40, y); y += 22;

    // =============================
    // LANÇAMENTOS
    // =============================
    const lref = collection(db, 'users', uid, 'caixas', cid, 'lancamentos');
    const lqs = await getDocs(query(lref, orderBy('createdAt','asc')));
    const lancamentosBody = [];
    let total = 0;

    lqs.forEach(d => {
      const x = d.data();
      lancamentosBody.push([
        brFromISO(x.dataCaixa),
        x.prefixo || '',
        x.tipoValidador || '',
        x.qtdBordos || '',
        fmtMoney(x.valor) || 'R$ 0,00',
        x.matriculaMotorista || ''
      ]);
      total += Number(x.valor || 0);
    });

    docpdf.autoTable({
      startY: y,
      head: [['Data Caixa','Prefixo','Validador','Qtd Bordos','Valor','Motorista']],
      body: lancamentosBody,
      theme: 'grid',
      headStyles: { fillColor: [200,200,200], textColor: 20, fontStyle: 'bold' },
      styles: { fontSize: 10, halign: 'center' },
      columnStyles: { 0:{halign:'center'},1:{halign:'center'},2:{halign:'center'},3:{halign:'center'},4:{halign:'right'},5:{halign:'center'} }
    });

    y = docpdf.lastAutoTable.finalY + 20;

    // =============================
    // SANGRIAS
    // =============================
    const sref = collection(db, 'users', uid, 'caixas', cid, 'sangrias');
    const sqs = await getDocs(query(sref, orderBy('createdAt','asc')));
    const sangriasBody = [];
    let totalS = 0;

    if (sqs.empty) {
      sangriasBody.push(['— Nenhuma', '']);
    } else {
      sqs.forEach(d => {
        const x = d.data();
        sangriasBody.push([ fmtMoney(x.valor), x.motivo || '' ]);
        totalS += Number(x.valor || 0);
      });
    }

    docpdf.autoTable({
      startY: y,
      head: [['Valor','Motivo']],
      body: sangriasBody,
      theme: 'grid',
      headStyles: { fillColor: [200,200,200], textColor: 20, fontStyle: 'bold' },
      styles: { fontSize: 10, halign: 'center' },
      columnStyles: { 0:{halign:'right'}, 1:{halign:'left'} }
    });

    y = docpdf.lastAutoTable.finalY + 20;

    // =============================
    // TOTAIS
    // =============================
    docpdf.setFont('helvetica','bold');
    docpdf.text(`TOTAL LANÇAMENTOS: ${fmtMoney(total)}`, 40, y); y+=16;
    docpdf.text(`TOTAL SANGRIAS: ${fmtMoney(totalS)}`, 40, y); y+=16;
    docpdf.text(`TOTAL CORRIGIDO: ${fmtMoney(total - totalS)}`, 40, y); y+=22;

    docpdf.setFont('helvetica','normal');
    docpdf.text('Fechamento resumido. Documento gerado automaticamente.', 40, y);

    const hojeNome = hoje.toLocaleDateString("pt-BR").replace(/\//g, "-");
    const fileName = `${currentUserDoc.matricula}-${hojeNome}.pdf`;
    docpdf.save(fileName);
  };
}
