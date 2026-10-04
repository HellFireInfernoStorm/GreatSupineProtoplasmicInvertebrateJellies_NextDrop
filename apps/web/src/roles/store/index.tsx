import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes } from "react-router";
import { RoleShell } from "../../app/RoleShell";
import { ROLE_PATHS } from "../../app/roles";
import { ShellHome } from "../../app/ShellHome";
import { useIsDesktop } from "../../lib/layout";
import { ItemsPage } from "./order/ItemsPage";
import { PlaceOrderPage } from "./order/PlaceOrderPage";
import { PlacedPage } from "./order/Placed";
import { ReviewPage } from "./order/ReviewPage";
import { PhoneScreen, StoreLayout } from "./StoreLayout";

/** My deliveries arrives with the other Store screens (#44). Until then the stand-in sits inside the Store frame. */
function Deliveries() {
  const { t } = useTranslation("store/shell");
  const desktop = useIsDesktop();
  if (desktop) return <ShellHome />;
  return (
    <PhoneScreen nav title={t("nav.deliveries")}>
      <ShellHome />
    </PhoneScreen>
  );
}

/** Store role shell. Add the role's screens as routes here. */
export function StoreShell() {
  return (
    <RoleShell role="STORE">
      <StoreLayout>
        <Routes>
          <Route index element={<Deliveries />} />
          <Route path="order" element={<PlaceOrderPage />} />
          <Route path="order/items" element={<ItemsPage />} />
          <Route path="order/review" element={<ReviewPage />} />
          <Route path="order/placed" element={<PlacedPage />} />
          <Route path="*" element={<Navigate to={ROLE_PATHS.STORE.home} replace />} />
        </Routes>
      </StoreLayout>
    </RoleShell>
  );
}
