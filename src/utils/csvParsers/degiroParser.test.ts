import { describe, expect, it } from 'vitest';
import { parseDegiroTransactionsCsv } from './degiroParser';
import { BrokerParsingError } from '../parserErrors';

const sampleCsv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
31-05-2023,09:04,VANGUARD S&P 500 UCITS ETF USD DIS,IE00B3XXRP09,EAM,XAMS,-1,"74,4890",EUR,"74,49",EUR,"74,49",,"0,00",,"74,49",,7de27f2e-430f-4bd0-9110-af75f4c65a89
31-05-2023,09:04,VANGUARD S&P 500 UCITS ETF USD DIS,IE00B3XXRP09,EAM,XAMS,-1,"74,4890",EUR,"74,49",EUR,"74,49",,"0,00","-1,00","73,49",,7de27f2e-430f-4bd0-9110-af75f4c65a89
02-10-2020,09:47,VANGUARD S&P 500 UCITS ETF USD DIS,IE00B3XXRP09,EAM,XAMS,2,"54,0000",EUR,"-108,00",EUR,"-108,00",,"0,00",,"-108,00",,a5d2688d-38db-41cd-a9a0-681f778201d4
`;

describe('parseDegiroTransactionsCsv', () => {
  it('extracts a 9.2A row from the provided DEGIRO sample', async () => {
    const fakeFile = new File([sampleCsv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A).toEqual([{
      codPais: '372',
      codigo: 'G20',
      anoRealizacao: '2023',
      mesRealizacao: '5',
      diaRealizacao: '31',
      valorRealizacao: '148.98',
      anoAquisicao: '2020',
      mesAquisicao: '10',
      diaAquisicao: '2',
      valorAquisicao: '108.00',
      despesasEncargos: '1.00',
      impostoPagoNoEstrangeiro: '0.00',
      codPaisContraparte: '620',
    }]);
    expect(data.rows8A).toEqual([]);
    expect(data.rows92B).toEqual([]);
    expect(data.rowsG13).toEqual([]);
  });

  it('splits a sell across multiple FIFO buy lots', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"0,00","-0,50","-10,50",,buy-1
01-02-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"20,0000",EUR,"-20,00",EUR,"-20,00",,"0,00","-0,50","-20,50",,buy-2
01-03-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-2,"30,0000",EUR,"60,00",EUR,"60,00",,"0,00","-2,00","58,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A).toHaveLength(2);
    expect(data.rows92A[0].valorRealizacao).toBe('30.00');
    expect(data.rows92A[0].valorAquisicao).toBe('10.00');
    expect(data.rows92A[0].despesasEncargos).toBe('1.50');
    expect(data.rows92A[1].valorRealizacao).toBe('30.00');
    expect(data.rows92A[1].valorAquisicao).toBe('20.00');
    expect(data.rows92A[1].despesasEncargos).toBe('1.50');
  });

  it('preserves totals exactly when a sell is split across three FIFO lots', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"0,00",,"-10,00",,buy-1
01-02-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"20,0000",EUR,"-20,00",EUR,"-20,00",,"0,00",,"-20,00",,buy-2
01-03-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"30,0000",EUR,"-30,00",EUR,"-30,00",,"0,00",,"-30,00",,buy-3
01-04-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-3,"33,3333",EUR,"100,00",EUR,"100,00",,"0,00","-1,00","99,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A).toHaveLength(3);
    expect(data.rows92A.map(row => row.valorRealizacao)).toEqual(['33.33', '33.33', '33.34']);
    expect(data.rows92A.map(row => row.despesasEncargos)).toEqual(['0.33', '0.33', '0.34']);
    expect(data.rows92A.reduce((total, row) => total + Number(row.valorRealizacao), 0).toFixed(2)).toBe('100.00');
    expect(data.rows92A.reduce((total, row) => total + Number(row.valorAquisicao), 0).toFixed(2)).toBe('60.00');
    expect(data.rows92A.reduce((total, row) => total + Number(row.despesasEncargos), 0).toFixed(2)).toBe('1.00');
  });

  it('includes AutoFX fees in despesasEncargos', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"-0,30",,"-10,30",,buy-1
01-02-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"15,0000",EUR,"15,00",EUR,"15,00",,"-0,20","-0,50","14,30",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A).toHaveLength(1);
    expect(data.rows92A[0].despesasEncargos).toBe('1.00');
  });

  it('preserves fee refunds as negative adjustments to despesasEncargos', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"0,00","-0,50","-10,50",,buy-1
01-02-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"15,0000",EUR,"15,00",EUR,"15,00",,"0,00","0,25","15,25",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A).toHaveLength(1);
    expect(data.rows92A[0].despesasEncargos).toBe('0.25');
  });

  it('filters generated rows to the requested realization year while keeping prior-year buys for FIFO', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
15-12-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"50,0000",EUR,"-50,00",EUR,"-50,00",,"0,00","-0,50","-50,50",,buy-1
15-01-2023,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"75,0000",EUR,"75,00",EUR,"75,00",,"0,00","-1,00","74,00",,sell-1
15-02-2024,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"60,0000",EUR,"-60,00",EUR,"-60,00",,"0,00","-0,50","-60,50",,buy-2
15-03-2024,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"90,0000",EUR,"90,00",EUR,"90,00",,"0,00","-1,00","89,00",,sell-2
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile, { targetRealizationYear: '2024' });

    expect(data.rows92A).toHaveLength(1);
    expect(data.rows92A[0].anoRealizacao).toBe('2024');
    expect(data.rows92A[0].anoAquisicao).toBe('2024');
  });

  it('fails target-year sells after a prior-year oversell exhausted partial FIFO inventory', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
10-01-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"25,0000",EUR,"-25,00",EUR,"-25,00",,"0,00","-0,50","-25,50",,buy-old
10-02-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-2,"30,0000",EUR,"60,00",EUR,"60,00",,"0,00","-1,00","59,00",,sell-old
10-03-2023,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"55,0000",EUR,"55,00",EUR,"55,00",,"0,00","-1,00","54,00",,sell-new
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    await expect(parseDegiroTransactionsCsv(fakeFile, { targetRealizationYear: '2023' })).rejects.toThrow(BrokerParsingError);
    await expect(parseDegiroTransactionsCsv(fakeFile, { targetRealizationYear: '2023' })).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_incomplete_history',
    });
  });

  it('keeps later target-year sells valid when earlier non-target-year sells were fully covered', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
10-01-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"30,0000",EUR,"-30,00",EUR,"-30,00",,"0,00","-0,50","-30,50",,buy-old
10-02-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"35,0000",EUR,"35,00",EUR,"35,00",,"0,00","-1,00","34,00",,sell-old
10-02-2023,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"40,0000",EUR,"-40,00",EUR,"-40,00",,"0,00","-0,50","-40,50",,buy-new
10-03-2023,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"55,0000",EUR,"55,00",EUR,"55,00",,"0,00","-1,00","54,00",,sell-new
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile, { targetRealizationYear: '2023' });

    expect(data.rows92A).toHaveLength(1);
    expect(data.rows92A[0].anoRealizacao).toBe('2023');
    expect(data.rows92A[0].anoAquisicao).toBe('2023');
  });

  it('returns no rows when target-year filtering leaves a valid DEGIRO CSV with no matching sells', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
15-12-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"50,0000",EUR,"-50,00",EUR,"-50,00",,"0,00","-0,50","-50,50",,buy-1
15-01-2023,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"75,0000",EUR,"75,00",EUR,"75,00",,"0,00","-1,00","74,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile, { targetRealizationYear: '2024' });

    expect(data.rows8A).toEqual([]);
    expect(data.rows92A).toEqual([]);
    expect(data.rows92B).toEqual([]);
    expect(data.rowsG13).toEqual([]);
  });

  it('classifies fund-like products as G20', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,VANGUARD UCITS ETF,IE00B3XXRP09,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"0,00",,"-10,00",,buy-1
01-02-2020,10:00,VANGUARD UCITS ETF,IE00B3XXRP09,EAM,XAMS,-1,"15,0000",EUR,"15,00",EUR,"15,00",,"0,00","-1,00","14,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A[0].codigo).toBe('G20');
  });

  it('classifies equity products as G01', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,ACME COMMON STOCK,US0000000001,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"0,00",,"-10,00",,buy-1
01-02-2020,10:00,ACME COMMON STOCK,US0000000001,EAM,XAMS,-1,"15,0000",EUR,"15,00",EUR,"15,00",,"0,00","-1,00","14,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A[0].codigo).toBe('G01');
  });

  it('classifies bond products as G10', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,CORP BOND 2030,US0000000001,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"0,00",,"-10,00",,buy-1
01-02-2020,10:00,CORP BOND 2030,US0000000001,EAM,XAMS,-1,"15,0000",EUR,"15,00",EUR,"15,00",,"0,00","-1,00","14,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A[0].codigo).toBe('G10');
  });

  it('defaults to G01 for plain company names (e.g. EDP SA) that lack explicit equity keywords', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,EDP SA,US0000000001,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"0,00",,"-10,00",,buy-1
01-02-2020,10:00,EDP SA,US0000000001,EAM,XAMS,-1,"15,0000",EUR,"15,00",EUR,"15,00",,"0,00","-1,00","14,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A[0].codigo).toBe('G01');
  });

  it('defaults to G01 for otherwise ambiguous product names', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,GLOBAL INCOME SECURITY,US0000000001,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"0,00",,"-10,00",,buy-1
01-02-2020,10:00,GLOBAL INCOME SECURITY,US0000000001,EAM,XAMS,-1,"15,0000",EUR,"15,00",EUR,"15,00",,"0,00","-1,00","14,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A[0].codigo).toBe('G01');
  });

  it('fails on derivative-like products', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,INDEX CFD,US0000000001,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"0,00",,"-10,00",,buy-1
01-02-2020,10:00,INDEX CFD,US0000000001,EAM,XAMS,-1,"15,0000",EUR,"15,00",EUR,"15,00",,"0,00","-1,00","14,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_unsupported_row',
    });
  });

  it('fails when a sell cannot be matched to prior buys', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-03-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"30,0000",EUR,"30,00",EUR,"30,00",,"0,00","-1,00","29,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_incomplete_history',
    });
  });

  it('fails when Valor EUR is blank', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"30,0000",EUR,"30,00",EUR,,,"0,00","-1,00","29,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_unsupported_row',
    });
  });

  it('fails on invalid dates', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
32-01-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"30,0000",EUR,"30,00",EUR,"30,00",,"0,00","-1,00","29,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_unsupported_row',
    });
  });

  it('fails on invalid times', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,99:99,ETF,IE00B3XXRP09,EAM,XAMS,-1,"30,0000",EUR,"30,00",EUR,"30,00",,"0,00","-1,00","29,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_unsupported_row',
    });
  });

  it('fails on unsupported headers', async () => {
    const fakeFile = new File(['Date,Time,ISIN\n'], 'degiro.csv', { type: 'text/csv' });
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_wrong_file',
    });
  });

  it('throws degiro_no_rows when file has only buy transactions (no sells)', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"0,00",,"-10,00",,buy-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_no_rows',
    });
  });

  it('throws degiro_unsupported_country for an unknown ISIN prefix', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,ETF,XX0000000001,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"0,00",,"-10,00",,buy-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_unsupported_country',
    });
  });

  it('ignores rows without an order ID (such as internal exchange transfers)', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
01-01-2020,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"10,0000",EUR,"-10,00",EUR,"-10,00",,"0,00",,"-10,00",,buy-1
01-02-2020,10:00,ETF,IE00B3XXRP09,EAM,,-1,"15,0000",EUR,"15,00",EUR,"15,00",,"0,00",,"15,00",
01-02-2020,10:00,ETF,IE00B3XXRP09,NSY,,1,"15,0000",EUR,"-15,00",EUR,"-15,00",,"0,00",,"-15,00",
01-03-2020,10:00,ETF,IE00B3XXRP09,NSY,XNYS,-1,"15,0000",EUR,"15,00",EUR,"15,00",,"0,00","-1,00","14,00",,sell-1
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A).toHaveLength(1);
    expect(data.rows92A[0].codigo).toBe('G20');
  });

  it('throws degiro_wrong_file for empty CSV (headers only with no data)', async () => {
    const csv = `Data,Hora,Produto,ISIN,Bolsa de refer\u00eancia,Bolsa,Quantidade,Pre\u00e7os,,Valor local,,Valor EUR,Taxa de C\u00e2mbio,Taxa Autofx,Custos de transa\u00e7\u00e3o e/ou taxas de terceiros,Total EUR,ID da Ordem,
`;

    const fakeFile = new File([csv], 'degiro.csv', { type: 'text/csv' });
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_wrong_file',
    });
  });

  it('parses V2 format (semicolon-separated) with date using /', async () => {
    const csv = `Data;Hora;Produto;ISIN;Bolsa de refer\u00eancia;Mercado;Quantidade;Pre\u00e7o;;Valor local;;Valor EUR;Taxa de c\u00e2mbio;Comiss\u00e3o AutoFX;Comiss\u00f5es de transa\u00e7\u00e3o e/ou de terceiros EUR;Total EUR
02/10/2020;09:47;VANGUARD S&P 500 UCITS ETF USD DIS;IE00B3XXRP09;EAM;XAMS;2;54,0000;EUR;-108,00;EUR;-108,00;;0;;-108,00
31/05/2023;09:04;VANGUARD S&P 500 UCITS ETF USD DIS;IE00B3XXRP09;EAM;XAMS;-1;74,4890;EUR;74,49;EUR;74,49;;0;;74,49`;

    const fakeFile = new File([csv], 'degiro-v2.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A).toHaveLength(1);
    expect(data.rows92A[0].anoRealizacao).toBe('2023');
    expect(data.rows92A[0].mesRealizacao).toBe('5');
    expect(data.rows92A[0].diaRealizacao).toBe('31');
    expect(data.rows92A[0].anoAquisicao).toBe('2020');
    expect(data.rows92A[0].mesAquisicao).toBe('10');
    expect(data.rows92A[0].diaAquisicao).toBe('2');
    expect(data.rows92A[0].impostoPagoNoEstrangeiro).toBe('0.00');
    expect(data.rows8A).toEqual([]);
    expect(data.rows92B).toEqual([]);
    expect(data.rowsG13).toEqual([]);
  });

  it('parses V2 format with Autofx and third-party fees', async () => {
    const csv = `Data;Hora;Produto;ISIN;Bolsa de refer\u00eancia;Mercado;Quantidade;Pre\u00e7o;;Valor local;;Valor EUR;Taxa de c\u00e2mbio;Comiss\u00e3o AutoFX;Comiss\u00f5es de transa\u00e7\u00e3o e/ou de terceiros EUR;Total EUR
02/10/2020;09:47;VANGUARD S&P 500 UCITS ETF USD DIS;IE00B3XXRP09;EAM;XAMS;2;54,0000;EUR;-108,00;EUR;-108,00;;0;;-108,00
31/05/2023;09:04;VANGUARD S&P 500 UCITS ETF USD DIS;IE00B3XXRP09;EAM;XAMS;-1;74,4890;EUR;74,49;EUR;74,49;;-0,30;-0,50;73,69`;

    const fakeFile = new File([csv], 'degiro-v2.csv', { type: 'text/csv' });
    const data = await parseDegiroTransactionsCsv(fakeFile);

    expect(data.rows92A).toHaveLength(1);
    expect(Number(data.rows92A[0].despesasEncargos)).toBeGreaterThan(0);
  });

  it('throws degiro_wrong_file for V1 headers with wrong delimiter', async () => {
    const csv = `Data;Hora;Produto;ISIN;Bolsa de refer\u00eancia;Bolsa;Quantidade;Pre\u00e7os;;Valor local;;Valor EUR;Taxa de C\u00e2mbio;Taxa Autofx;Custos de transa\u00e7\u00e3o e/ou taxas de terceiros;Total EUR;ID da Ordem;
31-05-2023;09:04;ETF;IE00B3XXRP09;EAM;XAMS;-1;74,4890;EUR;74,49;EUR;74,49;;0,00;;74,49;7de27f2e`;

    const fakeFile = new File([csv], 'bad.csv', { type: 'text/csv' });
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseDegiroTransactionsCsv(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_wrong_file',
    });
  });
});
