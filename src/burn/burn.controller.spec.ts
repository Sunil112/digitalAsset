import { BurnController } from './burn.controller';
import { BurnService } from './burn.service';
import { BurnStatus } from './types/burn.types';

const baseBurn = {
  id: 'burn-1',
  adminPartyId: 'EY',
  assetId: 'asset-001',
  requestedByPartyId: 'Alice',
  holdingContractId: 'holding-1',
  qty: 10,
  status: BurnStatus.PENDING,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('BurnController', () => {
  let controller: BurnController;
  let burnService: Pick<BurnService, 'createBurnRequest' | 'getAllBurnRequests' | 'approveBurnRequest' | 'cancelBurnRequest'>;

  beforeEach(() => {
    burnService = {
      createBurnRequest: jest.fn().mockResolvedValue(baseBurn),
      getAllBurnRequests: jest.fn().mockResolvedValue([baseBurn]),
      approveBurnRequest: jest.fn().mockResolvedValue({ ...baseBurn, status: BurnStatus.APPROVED }),
      cancelBurnRequest: jest.fn().mockResolvedValue({ ...baseBurn, status: BurnStatus.CANCELLED }),
    } as any;

    controller = new BurnController(burnService as BurnService);
  });

  it('creates a burn request', async () => {
    const dto = { adminPartyId: 'EY', assetId: 'asset-001', requestedByPartyId: 'Alice', holdingContractId: 'holding-1', qty: 10 };
    const result = await controller.createBurnRequest(dto as any);

    expect(burnService.createBurnRequest).toHaveBeenCalledWith(dto);
    expect(result).toEqual(baseBurn);
  });

  it('lists burn requests with no filters', async () => {
    const result = await controller.listBurnRequests();

    expect(burnService.getAllBurnRequests).toHaveBeenCalledWith(undefined, undefined);
    expect(result).toEqual([baseBurn]);
  });

  it('lists burn requests filtered by adminPartyId and assetId', async () => {
    const result = await controller.listBurnRequests('EY', 'asset-001');

    expect(burnService.getAllBurnRequests).toHaveBeenCalledWith('EY', 'asset-001');
    expect(result).toEqual([baseBurn]);
  });

  it('approves a burn request', async () => {
    const dto = { adminPartyId: 'EY', burnRequestId: 'burn-1' };
    const result = await controller.approveBurnRequest(dto as any);

    expect(burnService.approveBurnRequest).toHaveBeenCalledWith(dto);
    expect(result.status).toBe(BurnStatus.APPROVED);
  });

  it('cancels a burn request', async () => {
    const dto = { requestedByPartyId: 'Alice', burnRequestId: 'burn-1' };
    const result = await controller.cancelBurnRequest(dto as any);

    expect(burnService.cancelBurnRequest).toHaveBeenCalledWith(dto);
    expect(result.status).toBe(BurnStatus.CANCELLED);
  });
});
