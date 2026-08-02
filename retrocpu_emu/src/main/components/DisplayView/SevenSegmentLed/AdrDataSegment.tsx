import React, { useState } from "react";
import { SevenSegment } from "./SevenSegment";

/**
 * 7セグメントLED アドレス部16進6桁 データ部16進4桁
 * @param address 7セグメントLED アドレス部16進6桁
 * @param data 7セグメントLED データ部16進4桁
 */
const AdrDataAllSegment: React.FC<{
  address: Uint8Array[];
  data: Uint8Array[];
}> = ({ address, data }) => {
  const [hexAddressValue, setHexAddressValue] = useState<Array<string>>([]);
  const [hexDataValue, setHexDataValue] = useState<Array<string>>([]);

  React.useEffect((): void => {
    const hexAddressStr: Array<string> = address.map((byteArray) =>
      Array.from(byteArray)
        .map(
          (byte) =>
            (byte & 0x0f).toString(16).padStart(2, "0").toUpperCase() +
            ((byte >> 4) & 0x0f).toString(16).padStart(2, "0").toUpperCase(),
        )
        .join(""),
    );
    const hexDataStr: Array<string> = data.map((byteArray) =>
      Array.from(byteArray)
        .map(
          (byte) =>
            (byte & 0x0f).toString(16).padStart(2, "0").toUpperCase() +
            ((byte >> 4) & 0x0f).toString(16).padStart(2, "0").toUpperCase(),
        )
        .join(""),
    );
    setHexAddressValue(hexAddressStr);
    setHexDataValue(hexDataStr);
    console.log("AllSegment updated:", { address, data });
  }, [address, data]);

  return (
    <>
      <div style={{ display: "flex", gap: 8 }}>
        {/* アドレスは下位から積まれるので、逆順に表示する */}
        {hexAddressValue
          .slice()
          .reverse()
          .map((hexString, i) => (
            <SevenSegment key={i} value={hexString} decimalPoint={false} />
          ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {/* データは下位から積まれるので、逆順に表示する */}
        {hexDataValue
          .slice()
          .reverse()
          .map((hexString, i) => (
            <SevenSegment key={i} value={hexString} decimalPoint={false} />
          ))}
      </div>
    </>
  );
};

export default AdrDataAllSegment;
