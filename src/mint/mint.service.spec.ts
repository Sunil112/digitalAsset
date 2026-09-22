jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
  },
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DamlService } from '../daml/daml-ledger.service';
import { MintService } from './mint.service';
import { MintStatus } from './types/mint.types';

function makeDamlService(overrides: Partial<DamlService> = {}): DamlService {
  return {
    isEnabled: jest.fn().mockReturnValue(false),
    createMintRequest: jest.fn(),
    approveMintRequest: jest.fn(),
    cancelMintRequest: jest.fn(),
    ...overrides,
  } as unknown as DamlService;
}

const createDto = {
  adminPartyId: 'EY',
  assetId: 'asset-001',
  issuerPartyId: 'Issuer',
  targetOwnerPartyId: 'Alice',
  qty: 100,
};

describe('MintService', () => {
  it('creates a mint request and skips DAML when disabled', async () => {
    const daml = makeDamlService();
    const service = new MintService(daml);

    const result = await service.createMintRequest(createDto);

    expect(daml.createMintRequest).not.toHaveBeenCalled();
    expect(result.status).toBe(MintStatus.PENDING);
    expect(result.metadata?.damlSyncStatus).toBe('SKIPPED');
    expect(result.adminPartyId).toBe('EY');
    expect(result.qty).toBe(100);
  });

  it('creates a mint request and syncs with DAML', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createMintRequest: jest.fn().mockResolvedValue({ mintContractId: 'cid-mint-1' }),
    });
    const service = new MintService(daml);

    const result = await service.createMintRequest(createDto);

    expect(daml.createMintRequest).toHaveBeenCalledWith('EY', 'asset-001', 'Issuer', 'Alice', 100);
    expect(result.damlContractId).toBe('cid-mint-1');
    expect(result.metadata?.damlSyncStatus).toBe('SYNCED');
  });

  it('handles DAML failure gracefully on create', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createMintRequest: jest.fn().mockRejectedValue(new Error('DAML down')),
    });
    const service = new MintService(daml);

    const result = await service.createMintRequest(createDto);

    expect(result.status).toBe(MintStatus.PENDING);
    expect(result.metadata?.damlSyncStatus).toBe('LOCAL_ONLY');
    expect(result.metadata?.damlSyncError).toBe('DAML down');
  });

  it('approves a pending mint request', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createMintRequest: jest.fn().mockResolvedValue({ mintContractId: 'cid-mint-1' }),
      approveMintRequest: jest.fn().mockResolvedValue('holding-cid-1'),
    });
    const service = new MintService(daml);

    const created = await service.createMintRequest(createDto);
    const approved = await service.approveMintRequest({
      adminPartyId: 'EY',
      issuerPartyId: 'Issuer',
      mintRequestId: created.id,
    });

    expect(daml.approveMintRequest).toHaveBeenCalledWith('EY', 'Issuer', 'asset-001', 'cid-mint-1');
    expect(approved.status).toBe(MintStatus.APPROVED);
    expect(approved.holdingContractId).toBe('holding-cid-1');
    expect(approved.metadata?.damlSyncStatus).toBe('SYNCED');
  });

  it('throws NotFoundException when approving unknown request', async () => {
    const daml = makeDamlService();
    const service = new MintService(daml);

    await expect(service.approveMintRequest({
      adminPartyId: 'EY',
      issuerPartyId: 'Issuer',
      mintRequestId: 'does-not-exist',
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when approving already-approved request', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createMintRequest: jest.fn().mockResolvedValue({ mintContractId: 'cid-mint-1' }),
      approveMintRequest: jest.fn().mockResolvedValue('holding-cid-1'),
    });
    const service = new MintService(daml);

    const created = await service.createMintRequest(createDto);
    await service.approveMintRequest({ adminPartyId: 'EY', issuerPartyId: 'Issuer', mintRequestId: created.id });

    await expect(service.approveMintRequest({
      adminPartyId: 'EY',
      issuerPartyId: 'Issuer',
      mintRequestId: created.id,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancels a pending mint request', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createMintRequest: jest.fn().mockResolvedValue({ mintContractId: 'cid-mint-1' }),
      cancelMintRequest: jest.fn().mockResolvedValue(undefined),
    });
    const service = new MintService(daml);

    const created = await service.createMintRequest(createDto);
    const cancelled = await service.cancelMintRequest({
      issuerPartyId: 'Issuer',
      mintRequestId: created.id,
    });

    expect(daml.cancelMintRequest).toHaveBeenCalledWith('Issuer', 'asset-001', 'cid-mint-1');
    expect(cancelled.status).toBe(MintStatus.CANCELLED);
  });

  it('filters getAllMintRequests by adminPartyId and assetId', async () => {
    const daml = makeDamlService();
    const service = new MintService(daml);

    await service.createMintRequest(createDto);
    await service.createMintRequest({ ...createDto, assetId: 'asset-002' });

    const all = await service.getAllMintRequests();
    expect(all).toHaveLength(2);

    const filtered = await service.getAllMintRequests('EY', 'asset-001');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].assetId).toBe('asset-001');
  });
});
