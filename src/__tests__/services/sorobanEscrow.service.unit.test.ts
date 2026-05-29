import { SorobanEscrowService, SorobanEscrowClient } from '../../services/sorobanEscrow.service';
import { AuditLoggerService } from '../../services/audit-logger.service';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock('../../services/audit-logger.service', () => ({
  AuditLoggerService: {
    logEvent: jest.fn().mockResolvedValue(null),
  },
}));

function createMockClient(): jest.Mocked<SorobanEscrowClient> {
  return {
    simulate: jest.fn().mockResolvedValue(undefined),
    invoke: jest.fn().mockResolvedValue({
      txHash: 'tx-1',
      result: { escrowId: 'escrow-1', status: 'pending' },
    }),
    getEscrowState: jest.fn().mockResolvedValue({
      escrowId: 'escrow-1',
      status: 'pending',
    }),
    streamPendingEscrows: jest.fn().mockResolvedValue(() => {}),
  };
}

describe('SorobanEscrowService', () => {
  const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  beforeEach(() => {
    process.env.SOROBAN_ESCROW_CONTRACT_ADDRESS = contractAddress;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('invokes create_escrow with simulation first', async () => {
    const client = createMockClient();
    SorobanEscrowService.setClient(client);

    const result = await SorobanEscrowService.createEscrow({
      bookingId: 'booking-1',
      learnerId: 'learner-1',
      mentorId: 'mentor-1',
      amount: '50.0000000',
      currency: 'XLM',
    });

    expect(client.simulate).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'create_escrow' }),
    );
    expect(client.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'create_escrow' }),
    );
    expect(result).toEqual({
      contractAddress,
      escrowId: 'escrow-1',
      txHash: 'tx-1',
    });
  });

  it('invokes release_funds with simulation first', async () => {
    const client = createMockClient();
    SorobanEscrowService.setClient(client);

    await SorobanEscrowService.releaseFunds({
      escrowId: 'escrow-1',
      releasedBy: 'learner-1',
    });

    expect(client.simulate).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'release_funds' }),
    );
    expect(client.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'release_funds' }),
    );
  });

  it('invokes refund with simulation first', async () => {
    const client = createMockClient();
    SorobanEscrowService.setClient(client);

    await SorobanEscrowService.refund({
      escrowId: 'escrow-1',
      refundedBy: 'mentor-1',
    });

    expect(client.simulate).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'refund' }),
    );
    expect(client.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'refund' }),
    );
  });

  it('invokes open_dispute with simulation first', async () => {
    const client = createMockClient();
    SorobanEscrowService.setClient(client);

    await SorobanEscrowService.openDispute({
      escrowId: 'escrow-1',
      raisedBy: 'mentor-1',
      reason: 'Session was not delivered',
    });

    expect(client.simulate).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'open_dispute' }),
    );
    expect(client.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'open_dispute' }),
    );
  });

  it('invokes resolve_dispute with split percentage', async () => {
    const client = createMockClient();
    SorobanEscrowService.setClient(client);

    await SorobanEscrowService.resolveDispute({
      escrowId: 'escrow-1',
      splitPercentage: 60,
      resolvedBy: 'admin-1',
    });

    expect(client.simulate).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'resolve_dispute',
        args: ['escrow-1', 60],
      }),
    );
    expect(client.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'resolve_dispute' }),
    );
  });

  it('retries failed invocations up to 5 attempts and alerts admin', async () => {
    jest.useFakeTimers();

    const client = createMockClient();
    const exhaustionError = new Error('rpc timeout');
    client.invoke.mockRejectedValue(exhaustionError);
    SorobanEscrowService.setClient(client);

    const pending = SorobanEscrowService.releaseFunds({
      escrowId: 'escrow-1',
      releasedBy: 'learner-1',
    });

    await jest.runAllTimersAsync();

    await expect(pending).rejects.toThrow('rpc timeout');
    expect(client.simulate).toHaveBeenCalledTimes(5);
    expect(client.invoke).toHaveBeenCalledTimes(5);
    expect(
      (AuditLoggerService.logEvent as jest.MockedFunction<typeof AuditLoggerService.logEvent>),
    ).toHaveBeenCalled();
  });
});
