# Como o IRS Helper Funciona

O processo é simples e tem três passos.

A aplicação funciona totalmente no seu computador e nenhum ficheiro carregado é enviado para servidores. A maior parte do processamento funciona offline depois de a aplicação carregar, mas a conversão USD/EUR da E*TRADE pode precisar de internet para descarregar taxas de câmbio públicas do BCE quando ainda não estiverem em cache no browser.

## Passo 1: Obter e carregar o ficheiro XML do IRS
1. Aceda ao [Portal das Finanças para a entrega do IRS de 2025](https://irs.portaldasfinancas.gov.pt/app/entrega/v2026).
2. Escolha a opção "Obtenção de uma declaração pré-preenchida".
3. Clique em "Validar" e corrija todos os erros.
4. Quando a declaração já não apresentar erros, abra a opção "Anexos", no canto superior esquerdo.
5. Adicione os anexos G e J.
6. Clique em "Gravar" e guarde o ficheiro XML no seu computador.
7. Carregue esse ficheiro no IRS Helper. Este XML serve de base ao preenchimento automático e contém a estrutura e os campos obrigatórios exigidos pela Autoridade Tributária.

## Passo 2: Carregar relatórios ou exportações CSV das corretoras
1. Carregue todos os ficheiros relevantes das suas corretoras. Neste momento, são suportadas a XTB, a Trade Republic, a Trading 212, o ActivoBank, a Freedom24, a Interactive Brokers, a DEGIRO e a E*TRADE através de relatórios PDF, exportações CSV e workbooks XLSX (alguns valores ainda não são importados, valide as limitações na página principal)
2. Clique em "Gerar Ficheiro de Importação IRS".
3. A aplicação analisa automaticamente os ficheiros e extrai tabelas estruturadas com as suas transações financeiras.
4. No fim, pode consultar um pequeno relatório e um comparador para confirmar as alterações feitas ao ficheiro XML.

## Passo 3: Rever, descarregar e importar o ficheiro
1. Descarregue o ficheiro enriquecido e guarde-o no seu computador.
2. Volte ao [Portal das Finanças para a entrega do IRS de 2025](https://irs.portaldasfinancas.gov.pt/app/entrega/v2026).
3. Escolha a opção "Leitura de uma declaração previamente gravada num ficheiro".
4. Selecione o ficheiro gerado pelo IRS Helper.
5. Os valores dos relatórios devem agora aparecer na sua declaração online. Valide os valores manualmente.
