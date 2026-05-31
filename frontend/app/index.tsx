import { View, ActivityIndicator } from "react-native";
import { colors } from "@/src/theme";

export default function Index() {
  return (
    <View testID="splash-screen" style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}
