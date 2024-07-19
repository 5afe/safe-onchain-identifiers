import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import type { AddressLike, BigNumberish, BytesLike, Signer } from "ethers";
import { ethers } from "hardhat";

describe("Onchain Identifier", function () {
  const IDENTIFIER = ethers.getAddress(
    ethers.dataSlice(ethers.id("OnchainIdentifier"), 12, 32),
  );

  async function setup() {
    const EntryPoint = await ethers.deployContract("EntryPoint");
    const contracts = {
      Counter: await ethers.deployContract("Counter"),
      SafeL2: await ethers.deployContract("SafeL2"),
      SafeProxyFactory: await ethers.deployContract("SafeProxyFactory"),
      EntryPoint,
      Safe4337Module: await ethers.deployContract("Safe4337Module", [
        EntryPoint,
      ]),
      SafeModuleSetup: await ethers.deployContract("SafeModuleSetup"),
    };

    const [relayer, owner] = await ethers.getSigners();
    const bundler = {
      // Fake it 'til you make it... This just executes a user operation directly to the EntryPoint
      // contract to simulate the bundler's behavior. This can be replaced with a real bundler.
      sendUserOperation: async (
        userOp: UserOperation,
        entryPoint: AddressLike,
      ) => {
        const packedUserOp = await packUserOp(userOp);
        const userOpHash = await contracts.EntryPoint.getUserOpHash(
          packedUserOp,
        );
        const EntryPoint = await ethers.getContractAt("EntryPoint", entryPoint);
        await EntryPoint.connect(relayer).handleOps(
          [packedUserOp],
          relayer,
        );
        return userOpHash;
      },
    };

    const initializer = contracts.SafeL2.interface.encodeFunctionData(
      "setup",
      [
        [await owner.getAddress()],
        1,
        await contracts.SafeModuleSetup.getAddress(),
        contracts.SafeModuleSetup.interface.encodeFunctionData(
          "enableModules",
          [[await contracts.Safe4337Module.getAddress()]],
        ),
        await contracts.Safe4337Module.getAddress(),
        ethers.ZeroAddress,
        0,
        ethers.ZeroAddress,
      ],
    );
    const safeAddress = await contracts.SafeProxyFactory.createProxyWithNonce
      .staticCall(contracts.SafeL2, initializer, 0x5afe);
    await contracts.SafeProxyFactory.createProxyWithNonce(
      contracts.SafeL2,
      initializer,
      0x5afe,
    );
    const safe = await ethers.getContractAt("SafeL2", safeAddress, owner);

    return { contracts, owner, bundler, safe };
  }

  describe("Append Data", function () {
    describe("Safe Creation", function () {
      it("Standard", async function () {
        const { contracts, owner } = await loadFixture(setup);

        await contracts.SafeProxyFactory.createProxyWithNonce(
          contracts.SafeL2,
          ethers.concat([
            contracts.SafeL2.interface.encodeFunctionData("setup", [
              [await owner.getAddress()],
              1,
              ethers.ZeroAddress,
              "0x",
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              0,
              ethers.ZeroAddress,
            ]),
            IDENTIFIER,
          ]),
          0,
        );

        // REQUIRES TRACING TO RECOVER IDENTIFIER.
      });

      it("4337", async function () {
        const { contracts, owner, bundler } = await loadFixture(setup);

        const initializer = contracts.SafeL2.interface.encodeFunctionData(
          "setup",
          [
            [await owner.getAddress()],
            1,
            await contracts.SafeModuleSetup.getAddress(),
            contracts.SafeModuleSetup.interface.encodeFunctionData(
              "enableModules",
              [[await contracts.Safe4337Module.getAddress()]],
            ),
            await contracts.Safe4337Module.getAddress(),
            ethers.ZeroAddress,
            0,
            ethers.ZeroAddress,
          ],
        );
        const userOp = {
          sender: await contracts.SafeProxyFactory.createProxyWithNonce
            .staticCall(contracts.SafeL2, initializer, 0),
          nonce: 0,
          factory: contracts.SafeProxyFactory,
          factoryData: contracts.SafeProxyFactory.interface.encodeFunctionData(
            "createProxyWithNonce",
            [await contracts.SafeL2.getAddress(), initializer, 0],
          ),
          callData: ethers.concat([
            contracts.Safe4337Module.interface.encodeFunctionData(
              "executeUserOp",
              [
                await contracts.Counter.getAddress(),
                0,
                contracts.Counter.interface.encodeFunctionData("increment"),
                0,
              ],
            ),
            IDENTIFIER,
          ]),
          callGasLimit: 100000,
          verificationGasLimit: 500000,
          preVerificationGas: 100000,
          maxFeePerGas: 1e9,
          maxPriorityFeePerGas: 1e9,
        };
        const signature = await signUserOperation(owner, {
          userOp,
          module: contracts.Safe4337Module,
          validAfter: 0,
          validUntil: 0,
        });

        await owner.sendTransaction({
          to: userOp.sender,
          value: ethers.parseEther("0.1"),
        });
        await bundler.sendUserOperation(
          { ...userOp, signature },
          contracts.EntryPoint,
        );

        // REQUIRES TRACING TO RECOVER IDENTIFIER.
      });
    });

    describe("Transaction", function () {
      it("Standard", async function () {
        const { contracts, owner, safe } = await loadFixture(setup);

        await owner.sendTransaction({
          to: safe,
          data: ethers.concat([
            await safe.interface.encodeFunctionData("execTransaction", [
              await contracts.Counter.getAddress(),
              0,
              contracts.Counter.interface.encodeFunctionData("increment"),
              0,
              0,
              0,
              0,
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              await approvedHashSignature(owner),
            ]),
            IDENTIFIER,
          ]),
        });

        // REQUIRES TRACING TO RECOVER IDENTIFIER.
      });

      it("4337", async function () {
        const { contracts, owner, bundler, safe } = await loadFixture(setup);

        const userOp = {
          sender: await safe.getAddress(),
          nonce: 0,
          callData: ethers.concat([
            contracts.Safe4337Module.interface.encodeFunctionData(
              "executeUserOp",
              [
                await contracts.Counter.getAddress(),
                0,
                contracts.Counter.interface.encodeFunctionData("increment"),
                0,
              ],
            ),
            IDENTIFIER,
          ]),
          callGasLimit: 100000,
          verificationGasLimit: 500000,
          preVerificationGas: 100000,
          maxFeePerGas: 1e9,
          maxPriorityFeePerGas: 1e9,
        };
        const signature = await signUserOperation(owner, {
          userOp,
          module: contracts.Safe4337Module,
          validAfter: 0,
          validUntil: 0,
        });

        await owner.sendTransaction({
          to: userOp.sender,
          value: ethers.parseEther("0.1"),
        });
        await bundler.sendUserOperation(
          { ...userOp, signature },
          contracts.EntryPoint,
        );

        // REQUIRES TRACING TO RECOVER IDENTIFIER.
      });
    });
  });

  describe("Other...", function () {
    describe("Payment/Refund Receiver", function () {
      describe("Safe Creation", function () {
        it("Standard", async function () {
          const { contracts, owner } = await loadFixture(setup);

          await contracts.SafeProxyFactory.createProxyWithNonce(
            contracts.SafeL2,
            contracts.SafeL2.interface.encodeFunctionData("setup", [
              [await owner.getAddress()],
              1,
              ethers.ZeroAddress,
              "0x",
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              0,
              IDENTIFIER,
            ]),
            0,
          );

          // REQUIRES TRACING TO RECOVER IDENTIFIER.
        });

        it("4337", async function () {
          const { contracts, owner, bundler } = await loadFixture(setup);

          const initializer = contracts.SafeL2.interface.encodeFunctionData(
            "setup",
            [
              [await owner.getAddress()],
              1,
              await contracts.SafeModuleSetup.getAddress(),
              contracts.SafeModuleSetup.interface.encodeFunctionData(
                "enableModules",
                [[await contracts.Safe4337Module.getAddress()]],
              ),
              await contracts.Safe4337Module.getAddress(),
              ethers.ZeroAddress,
              0,
              IDENTIFIER,
            ],
          );
          const userOp = {
            sender: await contracts.SafeProxyFactory.createProxyWithNonce
              .staticCall(contracts.SafeL2, initializer, 0),
            nonce: 0,
            factory: contracts.SafeProxyFactory,
            factoryData: contracts.SafeProxyFactory.interface
              .encodeFunctionData(
                "createProxyWithNonce",
                [await contracts.SafeL2.getAddress(), initializer, 0],
              ),
            callData: contracts.Safe4337Module.interface.encodeFunctionData(
              "executeUserOp",
              [
                await contracts.Counter.getAddress(),
                0,
                contracts.Counter.interface.encodeFunctionData("increment"),
                0,
              ],
            ),
            callGasLimit: 100000,
            verificationGasLimit: 500000,
            preVerificationGas: 100000,
            maxFeePerGas: 1e9,
            maxPriorityFeePerGas: 1e9,
          };
          const signature = await signUserOperation(owner, {
            userOp,
            module: contracts.Safe4337Module,
            validAfter: 0,
            validUntil: 0,
          });

          await owner.sendTransaction({
            to: userOp.sender,
            value: ethers.parseEther("0.1"),
          });
          await bundler.sendUserOperation(
            { ...userOp, signature },
            contracts.EntryPoint,
          );

          // REQUIRES TRACING TO RECOVER IDENTIFIER.
        });
      });

      describe("Transaction", function () {
        it("Standard", async function () {
          const { contracts, owner, safe } = await loadFixture(setup);

          const transaction = await safe.execTransaction(
            contracts.Counter,
            0,
            contracts.Counter.interface.encodeFunctionData("increment"),
            0,
            0,
            0,
            0,
            ethers.ZeroAddress,
            IDENTIFIER,
            await approvedHashSignature(owner),
          );
          const receipt = await transaction.wait();
          const { data, topics } = receipt!.logs[0];
          const { refundReceiver } = safe.interface.decodeEventLog(
            "SafeMultiSigTransaction",
            data,
            topics,
          );
          expect(refundReceiver).to.equal(IDENTIFIER);
        });

        it("4337", function () {
          // NOT POSSIBLE TO USE THE REFUND RECEIVER WITH ERC-4337.
          this.skip();
        });
      });
    });

    describe("Salt Nonce", function () {
      describe("Safe Creation", function () {
        it("Standard", async function () {
          const { contracts, owner } = await loadFixture(setup);

          await contracts.SafeProxyFactory.createProxyWithNonce(
            contracts.SafeL2,
            contracts.SafeL2.interface.encodeFunctionData("setup", [
              [await owner.getAddress()],
              1,
              ethers.ZeroAddress,
              "0x",
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              0,
              ethers.ZeroAddress,
            ]),
            IDENTIFIER,
          );

          // REQUIRES TRACING TO RECOVER IDENTIFIER.
        });

        it("4337", async function () {
          const { contracts, owner, bundler } = await loadFixture(setup);

          const initializer = contracts.SafeL2.interface.encodeFunctionData(
            "setup",
            [
              [await owner.getAddress()],
              1,
              await contracts.SafeModuleSetup.getAddress(),
              contracts.SafeModuleSetup.interface.encodeFunctionData(
                "enableModules",
                [[await contracts.Safe4337Module.getAddress()]],
              ),
              await contracts.Safe4337Module.getAddress(),
              ethers.ZeroAddress,
              0,
              ethers.ZeroAddress,
            ],
          );
          const userOp = {
            sender: await contracts.SafeProxyFactory.createProxyWithNonce
              .staticCall(contracts.SafeL2, initializer, IDENTIFIER),
            nonce: 0,
            factory: contracts.SafeProxyFactory,
            factoryData: contracts.SafeProxyFactory.interface
              .encodeFunctionData(
                "createProxyWithNonce",
                [await contracts.SafeL2.getAddress(), initializer, IDENTIFIER],
              ),
            callData: contracts.Safe4337Module.interface.encodeFunctionData(
              "executeUserOp",
              [
                await contracts.Counter.getAddress(),
                0,
                contracts.Counter.interface.encodeFunctionData("increment"),
                0,
              ],
            ),
            callGasLimit: 100000,
            verificationGasLimit: 500000,
            preVerificationGas: 100000,
            maxFeePerGas: 1e9,
            maxPriorityFeePerGas: 1e9,
          };
          const signature = await signUserOperation(owner, {
            userOp,
            module: contracts.Safe4337Module,
            validAfter: 0,
            validUntil: 0,
          });

          await owner.sendTransaction({
            to: userOp.sender,
            value: ethers.parseEther("0.1"),
          });
          await bundler.sendUserOperation(
            { ...userOp, signature },
            contracts.EntryPoint,
          );

          // REQUIRES TRACING TO RECOVER IDENTIFIER.
        });
      });

      describe("Transaction", function () {
        it("Standard", function () {
          // SALT NONCE IS ONLY SPECIFIED DURING SAFE CREATION.
          this.skip();
        });

        it("4337", function () {
          // SALT NONCE IS ONLY SPECIFIED DURING SAFE CREATION.
          this.skip();
        });
      });
    });

    describe("4337 Nonce", function () {
      describe("Safe Creation", function () {
        it("Standard", function () {
          // 4337 NONCE IS ONLY SPECIFIED WITH 4337 USER OPERATIONS.
          this.skip();
        });

        it("4337", async function () {
          const { contracts, owner, bundler } = await loadFixture(setup);

          const initializer = contracts.SafeL2.interface.encodeFunctionData(
            "setup",
            [
              [await owner.getAddress()],
              1,
              await contracts.SafeModuleSetup.getAddress(),
              contracts.SafeModuleSetup.interface.encodeFunctionData(
                "enableModules",
                [[await contracts.Safe4337Module.getAddress()]],
              ),
              await contracts.Safe4337Module.getAddress(),
              ethers.ZeroAddress,
              0,
              ethers.ZeroAddress,
            ],
          );
          const sender = await contracts.SafeProxyFactory.createProxyWithNonce
            .staticCall(contracts.SafeL2, initializer, IDENTIFIER);
          const userOp = {
            sender,
            nonce: await contracts.EntryPoint.getNonce(sender, IDENTIFIER),
            factory: contracts.SafeProxyFactory,
            factoryData: contracts.SafeProxyFactory.interface
              .encodeFunctionData(
                "createProxyWithNonce",
                [await contracts.SafeL2.getAddress(), initializer, IDENTIFIER],
              ),
            callData: contracts.Safe4337Module.interface.encodeFunctionData(
              "executeUserOp",
              [
                await contracts.Counter.getAddress(),
                0,
                contracts.Counter.interface.encodeFunctionData("increment"),
                0,
              ],
            ),
            callGasLimit: 100000,
            verificationGasLimit: 500000,
            preVerificationGas: 100000,
            maxFeePerGas: 1e9,
            maxPriorityFeePerGas: 1e9,
          };
          const signature = await signUserOperation(owner, {
            userOp,
            module: contracts.Safe4337Module,
            validAfter: 0,
            validUntil: 0,
          });

          await owner.sendTransaction({
            to: userOp.sender,
            value: ethers.parseEther("0.1"),
          });
          const userOpHash = await bundler.sendUserOperation(
            { ...userOp, signature },
            contracts.EntryPoint,
          );

          const [{ args: { nonce } }] = await contracts.EntryPoint.queryFilter(
            contracts.EntryPoint.getEvent("UserOperationEvent")(userOpHash),
          );
          expect(nonce >> 64n).to.equal(BigInt(IDENTIFIER));
        });
      });

      describe("Transaction", function () {
        it("Standard", function () {
          // 4337 NONCE IS ONLY SPECIFIED WITH 4337 USER OPERATIONS.
          this.skip();
        });

        it("4337", async function () {
          const { contracts, owner, bundler, safe } = await loadFixture(setup);

          const userOp = {
            sender: await safe.getAddress(),
            nonce: await contracts.EntryPoint.getNonce(safe, IDENTIFIER),
            callData: contracts.Safe4337Module.interface.encodeFunctionData(
              "executeUserOp",
              [
                await contracts.Counter.getAddress(),
                0,
                contracts.Counter.interface.encodeFunctionData("increment"),
                0,
              ],
            ),
            callGasLimit: 100000,
            verificationGasLimit: 500000,
            preVerificationGas: 100000,
            maxFeePerGas: 1e9,
            maxPriorityFeePerGas: 1e9,
          };
          const signature = await signUserOperation(owner, {
            userOp,
            module: contracts.Safe4337Module,
            validAfter: 0,
            validUntil: 0,
          });

          await owner.sendTransaction({
            to: userOp.sender,
            value: ethers.parseEther("0.1"),
          });
          const userOpHash = await bundler.sendUserOperation(
            { ...userOp, signature },
            contracts.EntryPoint,
          );

          const [{ args: { nonce } }] = await contracts.EntryPoint.queryFilter(
            contracts.EntryPoint.getEvent("UserOperationEvent")(userOpHash),
          );
          expect(nonce >> 64n).to.equal(BigInt(IDENTIFIER));
        });
      });
    });
  });
});

type UserOperation = {
  sender: AddressLike;
  nonce: BigNumberish;
  factory?: AddressLike;
  factoryData?: BytesLike;
  callData: BytesLike;
  callGasLimit: BigNumberish;
  verificationGasLimit: BigNumberish;
  preVerificationGas: BigNumberish;
  maxFeePerGas: BigNumberish;
  maxPriorityFeePerGas: BigNumberish;
  paymaster?: AddressLike;
  paymasterVerificationGasLimit?: BigNumberish;
  paymasterPostOpGasLimit?: BigNumberish;
  paymasterData?: BytesLike;
  signature: BytesLike;
};

async function packUserOp(userOp: UserOperation) {
  return {
    sender: userOp.sender,
    nonce: userOp.nonce,
    initCode: userOp.factory !== undefined
      ? ethers.solidityPacked(["address", "bytes"], [
        await ethers.resolveAddress(userOp.factory),
        userOp.factoryData!,
      ])
      : "0x",
    callData: userOp.callData,
    accountGasLimits: ethers.solidityPacked(["uint128", "uint128"], [
      userOp.verificationGasLimit,
      userOp.callGasLimit,
    ]),
    preVerificationGas: userOp.preVerificationGas,
    gasFees: ethers.solidityPacked(["uint128", "uint128"], [
      userOp.maxPriorityFeePerGas,
      userOp.maxFeePerGas,
    ]),
    paymasterAndData: userOp.paymaster !== undefined
      ? ethers.solidityPacked([
        "address",
        "uint128",
        "uint128",
        "bytes",
      ], [
        await ethers.resolveAddress(userOp.paymaster),
        userOp.paymasterVerificationGasLimit,
        userOp.paymasterPostOpGasLimit,
        userOp.paymasterData,
      ])
      : "0x",
    signature: userOp.signature,
  };
}

async function approvedHashSignature(owner: AddressLike) {
  return ethers.solidityPacked(["uint256", "uint256", "uint8"], [
    await ethers.resolveAddress(owner),
    0,
    1,
  ]);
}

async function signUserOperation(
  owner: Signer,
  options: {
    userOp: Omit<UserOperation, "signature">;
    module: AddressLike;
    validAfter: number;
    validUntil: number;
  },
) {
  // Don't sign like this in practice... use EIP-712 or even better the Safe SDK!
  const module = await ethers.getContractAt(
    "Safe4337Module",
    await ethers.resolveAddress(options.module),
  );
  const packedUserOp = await packUserOp({ ...options.userOp, signature: "0x" });
  const userOpHash = await module.getOperationHash({
    ...packedUserOp,
    signature: ethers.solidityPacked(["uint48", "uint48"], [
      options.validAfter,
      options.validUntil,
    ]),
  });
  const signature = ethers.Signature.from(
    await owner.signMessage(ethers.getBytes(userOpHash)),
  );
  return ethers.solidityPacked([
    "uint48",
    "uint48",
    "bytes32",
    "bytes32",
    "uint8",
  ], [
    options.validAfter,
    options.validUntil,
    signature.r,
    signature.s,
    signature.v + 4,
  ]);
}
