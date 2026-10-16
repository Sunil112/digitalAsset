jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
  },
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DamlService } from '../daml/daml-ledger.service';
import { BurnService } from './burn.service';
import { BurnStatus } from './types/burn.types';

function makeDamlService(overrides: Partial<DamlService> = {}): DamlService {
  return {
    isEnabled: jest.fn().mockReturnValue(false),
    createBurnRequest: jest.fn(),
    approveBurnRequest: jest.fn(),
    cancelBurnRequest: jest.fn(),
    ...overrides,
  } as unknown as DamlService;
}

const createDto = {
  adminPartyId: 'EY',
  assetId: 'asset-001',
  requestedByPartyId: 'Alice',
  holdingContractId: 'holding-1',
  qty: 10,
};

describe('BurnService', () => {
  it('creates a burn request and skips DAML when disabled', async () => {
    const daml = makeDamlService();
    const service = new BurnService(daml);

    const result = await service.createBurnRequest(createDto);

    expect(daml.createBurnRequest).not.toHaveBeenCalled();
    expect(result.status).toBe(BurnStatus.PENDING);
    expect(result.metadata?.damlSyncStatus).toBe('SKIPPED');
    expect(result.adminPartyId).toBe('EY');
    expect(result.qty).toBe(10);
  });

  it('creates a burn request and syncs with DAML', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createBurnRequest: jest.fn().mockResolvedValue({ burnContractId: 'cid-burn-1' }),
    });
    const service = new BurnService(daml);

    const result = await service.createBurnRequest(createDto);

    expect(daml.createBurnRequest).toHaveBeenCalledWith('EY', 'asset-001', 'Alice', 'holding-1', 10);
    expect(result.damlContractId).toBe('cid-burn-1');
    expect(result.metadata?.damlSyncStatus).toBe('SYNCED');
  });

  it('handles DAML failure gracefully on create', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createBurnRequest: jest.fn().mockRejectedValue(new Error('DAML down')),
    });
    const service = new BurnService(daml);

    const result = await service.createBurnRequest(createDto);

    expect(result.status).toBe(BurnStatus.PENDING);
    expect(result.metadata?.damlSyncStatus).toBe('LOCAL_ONLY');
    expect(result.metadata?.damlSyncError).toBe('DAML down');
  });

  it('approves a pending burn request', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createBurnRequest: jest.fn().mockResolvedValue({ burnContractId: 'cid-burn-1' }),
      approveBurnRequest: jest.fn().mockResolvedValue('holding-cid-2'),
    });
    const service = new BurnService(daml);

    const created = await service.createBurnRequest(createDto);
    const approved = await service.approveBurnRequest({
      adminPartyId: 'EY',
      burnRequestId: created.id,
    });

    expect(daml.approveBurnRequest).toHaveBeenCalledWith('EY', 'asset-001', 'cid-burn-1');
    expect(approved.status).toBe(BurnStatus.APPROVED);
    expect(approved.resultingHoldingContractId).toBe('holding-cid-2');
    expect(approved.metadata?.damlSyncStatus).toBe('SYNCED');
  });

  it('throws NotFoundException when approving unknown request', async () => {
    const daml = makeDamlService();
    const service = new BurnService(daml);

    await expect(service.approveBurnRequest({
      adminPartyId: 'EY',
      burnRequestId: 'does-not-exist',
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when approving already-approved request', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createBurnRequest: jest.fn().mockResolvedValue({ burnContractId: 'cid-burn-1' }),
      approveBurnRequest: jest.fn().mockResolvedValue('holding-cid-2'),
    });
    const service = new BurnService(daml);

    const created = await service.createBurnRequest(createDto);
    await service.approveBurnRequest({ adminPartyId: 'EY', burnRequestId: created.id });

    await expect(service.approveBurnRequest({
      adminPartyId: 'EY',
      burnRequestId: created.id,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancels a pending burn request', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createBurnRequest: jest.fn().mockResolvedValue({ burnContractId: 'cid-burn-1' }),
      cancelBurnRequest: jest.fn().mockResolvedValue(undefined),
    });
    const service = new BurnService(daml);

    const created = await service.createBurnRequest(createDto);
    const cancelled = await service.cancelBurnRequest({
      requestedByPartyId: 'Alice',
      burnRequestId: created.id,
    });

    expect(daml.cancelBurnRequest).toHaveBeenCalledWith('Alice', 'asset-001', 'cid-burn-1');
    expect(cancelled.status).toBe(BurnStatus.CANCELLED);
  });

  it('filters getAllBurnRequests by adminPartyId and assetId', async () => {
    const daml = makeDamlService();
    const service = new BurnService(daml);

    await service.createBurnRequest(createDto);
    await service.createBurnRequest({ ...createDto, assetId: 'asset-002' });

    const all = await service.getAllBurnRequests();
    expect(all).toHaveLength(2);

    const filtered = await service.getAllBurnRequests('EY', 'asset-001');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].assetId).toBe('asset-001');
  });
});
