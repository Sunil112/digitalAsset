jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
  },
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DamlService } from '../daml/daml-ledger.service';
import { SwapService } from './swap.service';
import { SwapStatus } from './types/swap.types';

function makeDamlService(overrides: Partial<DamlService> = {}): DamlService {
  return {
    isEnabled: jest.fn().mockReturnValue(false),
    createSwapRequest: jest.fn(),
    acceptSwapRequest: jest.fn(),
    cancelSwapRequest: jest.fn(),
    lockSwapLegA: jest.fn(),
    lockSwapLegB: jest.fn(),
    settleAtomicSwap: jest.fn(),
    abortAtomicSwap: jest.fn(),
    ...overrides,
  } as unknown as DamlService;
}

const createDto = {
  swapId: 'swap-1',
  partyAId: 'Alice',
  partyBId: 'Bob',
  escrowPartyId: 'Escrow',
  pauseOwnerPartyId: 'EY',
  legAHoldingContractId: 'holding-a',
  legAQty: 10,
  legAAdminPartyId: 'AdminA',
  legBHoldingContractId: 'holding-b',
  legBQty: 20,
  legBAdminPartyId: 'AdminB',
};

describe('SwapService', () => {
  it('creates a swap request and skips DAML when disabled', async () => {
    const daml = makeDamlService();
    const service = new SwapService(daml);

    const result = await service.createSwapRequest(createDto);

    expect(daml.createSwapRequest).not.toHaveBeenCalled();
    expect(result.status).toBe(SwapStatus.PROPOSED);
    expect(result.metadata?.damlSyncStatus).toBe('SKIPPED');
  });

  it('creates a swap request and syncs with DAML', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createSwapRequest: jest.fn().mockResolvedValue({ swapRequestContractId: 'cid-swap-request-1' }),
    });
    const service = new SwapService(daml);

    const result = await service.createSwapRequest(createDto);

    expect(daml.createSwapRequest).toHaveBeenCalled();
    expect(result.damlSwapRequestContractId).toBe('cid-swap-request-1');
    expect(result.metadata?.damlSyncStatus).toBe('SYNCED');
  });

  it('accepts a proposed swap request', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createSwapRequest: jest.fn().mockResolvedValue({ swapRequestContractId: 'cid-swap-request-1' }),
      acceptSwapRequest: jest.fn().mockResolvedValue('cid-escrow-1'),
    });
    const service = new SwapService(daml);

    const created = await service.createSwapRequest(createDto);
    const accepted = await service.acceptSwapRequest({
      swapRequestId: created.id,
      partyBId: 'Bob',
      escrowPartyId: 'Escrow',
    });

    expect(daml.acceptSwapRequest).toHaveBeenCalledWith('Bob', 'Escrow', 'swap-1', 'cid-swap-request-1');
    expect(accepted.status).toBe(SwapStatus.ACCEPTED);
    expect(accepted.damlSwapEscrowContractId).toBe('cid-escrow-1');
  });

  it('locks both legs and transitions to READY_TO_SETTLE', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createSwapRequest: jest.fn().mockResolvedValue({ swapRequestContractId: 'cid-swap-request-1' }),
      acceptSwapRequest: jest.fn().mockResolvedValue('cid-escrow-1'),
      lockSwapLegA: jest.fn().mockResolvedValue('cid-escrow-2'),
      lockSwapLegB: jest.fn().mockResolvedValue('cid-escrow-3'),
    });
    const service = new SwapService(daml);

    const created = await service.createSwapRequest(createDto);
    await service.acceptSwapRequest({ swapRequestId: created.id, partyBId: 'Bob', escrowPartyId: 'Escrow' });

    const afterA = await service.lockLegA({
      swapRequestId: created.id,
      partyAId: 'Alice',
      escrowPartyId: 'Escrow',
      legAAdminPartyId: 'AdminA',
    });
    const afterAStatus = afterA.status;

    const afterB = await service.lockLegB({
      swapRequestId: created.id,
      partyBId: 'Bob',
      escrowPartyId: 'Escrow',
      legBAdminPartyId: 'AdminB',
    });

    expect(afterAStatus).toBe(SwapStatus.LEG_A_LOCKED);
    expect(afterB.status).toBe(SwapStatus.READY_TO_SETTLE);
    expect(daml.lockSwapLegA).toHaveBeenCalledWith('Alice', 'Escrow', 'AdminA', 'swap-1', 'cid-escrow-1');
    expect(daml.lockSwapLegB).toHaveBeenCalledWith('Bob', 'Escrow', 'AdminB', 'swap-1', 'cid-escrow-2');
  });

  it('settles a ready swap', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createSwapRequest: jest.fn().mockResolvedValue({ swapRequestContractId: 'cid-swap-request-1' }),
      acceptSwapRequest: jest.fn().mockResolvedValue('cid-escrow-1'),
      lockSwapLegA: jest.fn().mockResolvedValue('cid-escrow-2'),
      lockSwapLegB: jest.fn().mockResolvedValue('cid-escrow-3'),
      settleAtomicSwap: jest.fn().mockResolvedValue(undefined),
    });
    const service = new SwapService(daml);

    const created = await service.createSwapRequest(createDto);
    await service.acceptSwapRequest({ swapRequestId: created.id, partyBId: 'Bob', escrowPartyId: 'Escrow' });
    await service.lockLegA({ swapRequestId: created.id, partyAId: 'Alice', escrowPartyId: 'Escrow', legAAdminPartyId: 'AdminA' });
    await service.lockLegB({ swapRequestId: created.id, partyBId: 'Bob', escrowPartyId: 'Escrow', legBAdminPartyId: 'AdminB' });

    const settled = await service.settleAtomicSwap({
      swapRequestId: created.id,
      escrowPartyId: 'Escrow',
      legAAdminPartyId: 'AdminA',
      legBAdminPartyId: 'AdminB',
    });

    expect(daml.settleAtomicSwap).toHaveBeenCalledWith('Escrow', 'AdminA', 'AdminB', 'swap-1', 'cid-escrow-3');
    expect(settled.status).toBe(SwapStatus.SETTLED);
  });

  it('aborts an accepted swap', async () => {
    const daml = makeDamlService({
      isEnabled: jest.fn().mockReturnValue(true),
      createSwapRequest: jest.fn().mockResolvedValue({ swapRequestContractId: 'cid-swap-request-1' }),
      acceptSwapRequest: jest.fn().mockResolvedValue('cid-escrow-1'),
      abortAtomicSwap: jest.fn().mockResolvedValue(undefined),
    });
    const service = new SwapService(daml);

    const created = await service.createSwapRequest(createDto);
    await service.acceptSwapRequest({ swapRequestId: created.id, partyBId: 'Bob', escrowPartyId: 'Escrow' });

    const aborted = await service.abortAtomicSwap({
      swapRequestId: created.id,
      escrowPartyId: 'Escrow',
      legAAdminPartyId: 'AdminA',
      legBAdminPartyId: 'AdminB',
    });

    expect(daml.abortAtomicSwap).toHaveBeenCalledWith('Escrow', 'AdminA', 'AdminB', 'swap-1', 'cid-escrow-1');
    expect(aborted.status).toBe(SwapStatus.ABORTED);
  });

  it('throws NotFoundException for unknown swap request', async () => {
    const daml = makeDamlService();
    const service = new SwapService(daml);

    await expect(service.acceptSwapRequest({ swapRequestId: 'missing', partyBId: 'Bob', escrowPartyId: 'Escrow' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException for invalid state transitions', async () => {
    const daml = makeDamlService();
    const service = new SwapService(daml);

    const created = await service.createSwapRequest(createDto);
    await service.cancelSwapRequest({ swapRequestId: created.id, partyAId: 'Alice' });

    await expect(service.acceptSwapRequest({ swapRequestId: created.id, partyBId: 'Bob', escrowPartyId: 'Escrow' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
