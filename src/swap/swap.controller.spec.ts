import { SwapController } from './swap.controller';
import { SwapService } from './swap.service';
import { SwapStatus } from './types/swap.types';

const baseSwap = {
  id: 'swap-local-1',
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
  status: SwapStatus.PROPOSED,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('SwapController', () => {
  let controller: SwapController;
  let swapService: Pick<
    SwapService,
    | 'createSwapRequest'
    | 'getAllSwapRequests'
    | 'acceptSwapRequest'
    | 'cancelSwapRequest'
    | 'lockLegA'
    | 'lockLegB'
    | 'settleAtomicSwap'
    | 'abortAtomicSwap'
  >;

  beforeEach(() => {
    swapService = {
      createSwapRequest: jest.fn().mockResolvedValue(baseSwap),
      getAllSwapRequests: jest.fn().mockResolvedValue([baseSwap]),
      acceptSwapRequest: jest.fn().mockResolvedValue({ ...baseSwap, status: SwapStatus.ACCEPTED }),
      cancelSwapRequest: jest.fn().mockResolvedValue({ ...baseSwap, status: SwapStatus.CANCELLED }),
      lockLegA: jest.fn().mockResolvedValue({ ...baseSwap, status: SwapStatus.LEG_A_LOCKED }),
      lockLegB: jest.fn().mockResolvedValue({ ...baseSwap, status: SwapStatus.READY_TO_SETTLE }),
      settleAtomicSwap: jest.fn().mockResolvedValue({ ...baseSwap, status: SwapStatus.SETTLED }),
      abortAtomicSwap: jest.fn().mockResolvedValue({ ...baseSwap, status: SwapStatus.ABORTED }),
    } as any;

    controller = new SwapController(swapService as SwapService);
  });

  it('creates a swap request', async () => {
    const dto = {
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

    const result = await controller.createSwapRequest(dto as any);

    expect(swapService.createSwapRequest).toHaveBeenCalledWith(dto);
    expect(result).toEqual(baseSwap);
  });

  it('lists swap requests', async () => {
    const result = await controller.listSwapRequests();

    expect(swapService.getAllSwapRequests).toHaveBeenCalledWith();
    expect(result).toEqual([baseSwap]);
  });

  it('accepts a swap request', async () => {
    const dto = { swapRequestId: 'swap-local-1', partyBId: 'Bob', escrowPartyId: 'Escrow' };
    const result = await controller.acceptSwapRequest(dto as any);

    expect(swapService.acceptSwapRequest).toHaveBeenCalledWith(dto);
    expect(result.status).toBe(SwapStatus.ACCEPTED);
  });

  it('locks leg A', async () => {
    const dto = { swapRequestId: 'swap-local-1', partyAId: 'Alice', escrowPartyId: 'Escrow', legAAdminPartyId: 'AdminA' };
    const result = await controller.lockLegA(dto as any);

    expect(swapService.lockLegA).toHaveBeenCalledWith(dto);
    expect(result.status).toBe(SwapStatus.LEG_A_LOCKED);
  });

  it('locks leg B', async () => {
    const dto = { swapRequestId: 'swap-local-1', partyBId: 'Bob', escrowPartyId: 'Escrow', legBAdminPartyId: 'AdminB' };
    const result = await controller.lockLegB(dto as any);

    expect(swapService.lockLegB).toHaveBeenCalledWith(dto);
    expect(result.status).toBe(SwapStatus.READY_TO_SETTLE);
  });

  it('settles atomically', async () => {
    const dto = { swapRequestId: 'swap-local-1', escrowPartyId: 'Escrow', legAAdminPartyId: 'AdminA', legBAdminPartyId: 'AdminB' };
    const result = await controller.settleAtomic(dto as any);

    expect(swapService.settleAtomicSwap).toHaveBeenCalledWith(dto);
    expect(result.status).toBe(SwapStatus.SETTLED);
  });

  it('aborts a swap', async () => {
    const dto = { swapRequestId: 'swap-local-1', escrowPartyId: 'Escrow', legAAdminPartyId: 'AdminA', legBAdminPartyId: 'AdminB' };
    const result = await controller.abortSwap(dto as any);

    expect(swapService.abortAtomicSwap).toHaveBeenCalledWith(dto);
    expect(result.status).toBe(SwapStatus.ABORTED);
  });

  it('cancels a swap request', async () => {
    const dto = { swapRequestId: 'swap-local-1', partyAId: 'Alice' };
    const result = await controller.cancelSwapRequest(dto as any);

    expect(swapService.cancelSwapRequest).toHaveBeenCalledWith(dto);
    expect(result.status).toBe(SwapStatus.CANCELLED);
  });
});
