import { Navigate, Route, Routes } from "react-router";
import { RoleShell } from "../../app/RoleShell";
import { ROLE_PATHS } from "../../app/roles";
import { DeliveriesPage } from "./deliveries/DeliveriesPage";
import { ItemsPage } from "./order/ItemsPage";
import { PlaceOrderPage } from "./order/PlaceOrderPage";
import { PlacedPage } from "./order/Placed";
import { ReviewPage } from "./order/ReviewPage";
import { StoreLayout } from "./StoreLayout";
import { OrderPage } from "./tracking/OrderPage";
import { TrackingPage } from "./tracking/TrackingPage";

/** Store role shell. Add the role's screens as routes here. */
export function StoreShell() {
  return (
    <RoleShell role="STORE">
      <StoreLayout>
        <Routes>
          <Route index element={<DeliveriesPage />} />
          <Route path="order" element={<PlaceOrderPage />} />
          <Route path="order/items" element={<ItemsPage />} />
          <Route path="order/review" element={<ReviewPage />} />
          <Route path="order/placed" element={<PlacedPage />} />
          <Route path="tracking" element={<TrackingPage />} />
          <Route path="orders/:id" element={<OrderPage />} />
          <Route path="*" element={<Navigate to={ROLE_PATHS.STORE.home} replace />} />
        </Routes>
      </StoreLayout>
    </RoleShell>
  );
}
